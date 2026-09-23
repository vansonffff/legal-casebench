#!/usr/bin/env python3
"""Phase 4A：Legacy 案件识别、MigrationPlan 构造与 dry-run 渲染。

本模块**只读**：不写盘、不加锁、不创建任何文件。正式写入在 Phase 4C 交付。

设计依据（Phase 4 计划）：
- §6 / §45  legacy、partial、corrupted、unsupported 的分类与处置；
- §11      MigrationPlan 对象；dry-run 与 apply 共用同一份 plan（红线五）；
- §12 方案A dry-run 不生成正式 Matter ID，显示 <will-generate-on-apply>；
- §13      禁止用旧名称/路径构造 deterministic Matter ID；
- §15      Matter name 来源优先级与冲突告警；
- §53      dry-run 输出分类（WILL CREATE / MODIFY / PRESERVE / NOT TOUCH / WARNING / ERROR）。
"""

from __future__ import annotations

import datetime
import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any, Callable

import registry_io
from matter_io import (
    MATTER_FILENAME,
    STATE_FILENAME,
    STATE_SCHEMA_VERSION,
    SUPPORTED_STATE_SCHEMA_VERSIONS,
    MatterCredentialLeak,
    MatterError,
    MatterIdConflict,
    MatterSchemaUnsupported,
    MatterStateMissing,
    MigrationNotNeeded,
    MigrationPartialState,
    MigrationSourceInvalid,
    MigrationValidationFailed,
    load_matter,
    validate_issues,
    validate_matter_document,
)
from state_migration import migrate_state_v3_to_v4
from workspace_io import file_digest

WILL_GENERATE = "<will-generate-on-apply>"
MATTER_ID_GENERATE_ON_APPLY = "generate-on-apply"
MATTER_ID_EXISTING = "existing"
INDEX_ID_PLACEHOLDER = "<pending>"
PLAN_TIME_PLACEHOLDER = "<apply-time>"
SNAPSHOT_DIRNAME = ".migration"
SNAPSHOT_LABEL = "matter-v1"
NOTES_FILENAME = "00-案件笔记.md"

# --- 分类常量（§6 / §45） -------------------------------------------------

LEGACY_V3 = "LEGACY_V3"
MATTER_V4 = "MATTER_V4"
PARTIAL_MATTER_V3 = "PARTIAL_MATTER_V3"
PARTIAL_REGISTRY_V1 = "PARTIAL_REGISTRY_V1"
REGISTRY_ENTRY_MISSING = "REGISTRY_ENTRY_MISSING"
CORRUPTED_MATTER = "CORRUPTED_MATTER"
SUSPICIOUS_V4_WITHOUT_MATTER = "SUSPICIOUS_V4_WITHOUT_MATTER"
UNSUPPORTED_STATE = "UNSUPPORTED_STATE"
STATE_MISSING = "STATE_MISSING"
SOURCE_INVALID = "SOURCE_INVALID"
INCOMPLETE_TRANSACTION = "INCOMPLETE_TRANSACTION"

# 模式：normal migration / resume / registry-only resume / no-op / blocked
MODE_MIGRATE = "migrate"
MODE_RESUME = "resume"
MODE_RESUME_REGISTRY = "resume_registry"
MODE_NOOP = "noop"
MODE_BLOCKED = "blocked"

_MODES = {
    LEGACY_V3: MODE_MIGRATE,
    PARTIAL_MATTER_V3: MODE_RESUME,
    PARTIAL_REGISTRY_V1: MODE_RESUME_REGISTRY,
    REGISTRY_ENTRY_MISSING: MODE_RESUME_REGISTRY,
    MATTER_V4: MODE_NOOP,
    INCOMPLETE_TRANSACTION: MODE_RESUME_REGISTRY,
    CORRUPTED_MATTER: MODE_BLOCKED,
    SUSPICIOUS_V4_WITHOUT_MATTER: MODE_BLOCKED,
    UNSUPPORTED_STATE: MODE_BLOCKED,
    STATE_MISSING: MODE_BLOCKED,
    SOURCE_INVALID: MODE_BLOCKED,
}

KIND_LABELS = {
    LEGACY_V3: "Legacy State v3（可正常迁移）",
    MATTER_V4: "Matter + State v4 + Registry v2（已完成，无需迁移）",
    PARTIAL_MATTER_V3: "matter.yaml 已存在但 state 仍为 v3（恢复身份后继续迁移）",
    PARTIAL_REGISTRY_V1: "Matter + State v4 已一致但 Registry 仍为 v1（仅恢复 Registry）",
    REGISTRY_ENTRY_MISSING: "Matter + State v4 已一致但 Registry v2 缺条目（仅补登记）",
    CORRUPTED_MATTER: "matter.yaml 与 state 的 Matter ID 不一致（损坏，hard stop）",
    SUSPICIOUS_V4_WITHOUT_MATTER: "无 matter.yaml 但 state 已是 v4（来源不可证，hard stop）",
    UNSUPPORTED_STATE: "state schema 版本不受支持（hard stop，禁止降级）",
    STATE_MISSING: "有案件笔记但缺少 _case_state.json（hard stop，不自动创建）",
    SOURCE_INVALID: "目标不是案件目录（hard stop）",
    INCOMPLETE_TRANSACTION: "上一次迁移未完成（journal 仍未结清），从断点续跑",
}


def _timestamp() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


# --- Inspect（只读） -------------------------------------------------------


def load_state_readonly(path: Path) -> dict[str, Any]:
    """读取 state 而不触发 MatterStateMissing（分类阶段需要区分 missing）。"""

    import json

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MigrationSourceInvalid(f"无法读取案件状态：{path}: {exc}") from exc
    if not isinstance(data, dict):
        raise MigrationSourceInvalid(f"案件状态必须是 JSON 对象：{path}")
    return data


def inspect_case(case_dir: str | Path, root: str | Path | None = None) -> dict[str, Any]:
    """判定案件处于哪种 legacy/matter 状态；不修改任何文件。"""

    case_path = Path(case_dir).expanduser().resolve()
    if not case_path.is_dir():
        raise MigrationSourceInvalid(f"案件目录不存在或不是目录：{case_path}")
    product_root = Path(root).expanduser().resolve() if root else case_path.parent

    matter_file = case_path / MATTER_FILENAME
    state_file = case_path / STATE_FILENAME
    has_matter = matter_file.exists()
    has_state = state_file.exists()

    reasons: list[str] = []
    warnings: list[str] = []
    document: dict[str, Any] | None = None
    state: dict[str, Any] | None = None

    if has_matter:
        document = load_matter(matter_file)  # 无效/凭据泄漏在此 hard stop
        reasons.append(f"{MATTER_FILENAME} 存在且合法")
    if has_state:
        state = load_state_readonly(state_file)
        reasons.append(f"{STATE_FILENAME} 存在")

    version = state.get("schema_version") if isinstance(state, dict) else None
    matter_id = document["matter"]["id"] if isinstance(document, dict) else None
    state_id = state.get("matter_id") if isinstance(state, dict) else None

    kind = _classify(
        case_path=case_path,
        has_matter=has_matter,
        has_state=has_state,
        version=version,
        matter_id=matter_id,
        state_id=state_id,
    )
    reasons.append(KIND_LABELS[kind])

    names = {
        "state": state.get("case_name") if isinstance(state, dict) else None,
        "registry": None,
        "directory": case_path.name,
        "matter": document["matter"]["name"] if isinstance(document, dict) else None,
    }

    registry_path = product_root / registry_io.REGISTRY_FILENAME
    index_path = product_root / registry_io.INDEX_FILENAME
    registry = registry_io.load_registry(registry_path)
    registry_entry: dict[str, Any] | None = None

    if registry is not None:
        candidates = [value for value in (names["state"], names["directory"]) if isinstance(value, str) and value]
        registry_entry, entry_warnings = registry_io.resolve_entry(registry, candidates, case_path)
        warnings.extend(entry_warnings)
        if isinstance(registry_entry, dict):
            names["registry"] = registry_entry.get("name")

    kind, extra_warnings, extra_reasons = _refine_with_registry(
        kind=kind,
        registry=registry,
        registry_entry=registry_entry,
        matter_id=matter_id,
    )
    warnings.extend(extra_warnings)
    reasons.extend(extra_reasons)

    # 上次迁移没结清（例如崩在 index 步骤）：即使文件层面看起来已完整，
    # 也必须判为 resume，否则收尾步骤永远补不上（§33）。
    # Gate 2：事务日志的优先级高于普通状态分类。
    # 顺序固定为——先确认"存在属于本案件的未结清事务"，再谈文件层面是什么状态。
    journal = load_journal(product_root, case_path)
    if isinstance(journal, dict) and journal.get("status") == "in_progress":
        problems = verify_journal_identity(journal, case_path)
        if problems:
            raise MigrationSourceInvalid(
                "存在未结清的迁移日志，但它与当前案件不匹配，拒绝复用其 Matter ID：\n- "
                + "\n- ".join(problems)
                + f"\n请人工确认后删除或归档该日志：{journal_path(product_root, case_path)}"
            )
        if kind == MATTER_V4:
            # 文件层面看起来已完成，但事务没结清（例如崩在 index）→ 必须续跑。
            kind = INCOMPLETE_TRANSACTION
        reasons.append(f"发现属于本案件的未结清迁移事务（{journal.get('failed_step') or '中断于中途'}）")

    conflicts = _name_conflicts(names)
    if conflicts:
        warnings.append(conflicts)
    selected_name = _select_name(names)
    if selected_name is None:
        raise MigrationSourceInvalid(f"无法确定案件名称（三个来源均为空）：{case_path}")

    return {
        "case_dir": str(case_path),
        "product_root": str(product_root),
        "kind": kind,
        "mode": _MODES[kind],
        "reasons": reasons,
        "warnings": warnings,
        "state": state,
        "state_version": version,
        "matter": document,
        "matter_id": matter_id,
        "state_matter_id": state_id,
        "registry": registry,
        "registry_path": str(registry_path),
        "registry_version": registry_io.registry_version(registry),
        "registry_entry": registry_entry,
        "index_path": str(index_path),
        "notes_path": str(case_path / NOTES_FILENAME),
        "has_notes": (case_path / NOTES_FILENAME).exists(),
        "name_sources": names,
        "selected_name": selected_name,
    }


def _classify(
    *,
    case_path: Path,
    has_matter: bool,
    has_state: bool,
    version: Any,
    matter_id: str | None,
    state_id: Any,
) -> str:
    if not has_matter and not has_state:
        return STATE_MISSING if (case_path / NOTES_FILENAME).exists() else SOURCE_INVALID

    if has_matter and not has_state:
        return STATE_MISSING

    if not has_matter:
        if version == STATE_SCHEMA_VERSION:
            # §45 F：无 matter.yaml 却有 v4 state —— 无法证明 matter_id 来源，不得自动认领。
            return SUSPICIOUS_V4_WITHOUT_MATTER
        if version == 3:
            return LEGACY_V3
        return UNSUPPORTED_STATE

    # 有 matter.yaml 且有 state
    if version == 3:
        return PARTIAL_MATTER_V3
    if version != STATE_SCHEMA_VERSION:
        return UNSUPPORTED_STATE
    if not isinstance(state_id, str) or not state_id.strip() or state_id != matter_id:
        return CORRUPTED_MATTER
    return MATTER_V4


def _refine_with_registry(
    *,
    kind: str,
    registry: dict[str, Any] | None,
    registry_entry: dict[str, Any] | None,
    matter_id: str | None,
) -> tuple[str, list[str], list[str]]:
    warnings: list[str] = []
    reasons: list[str] = []
    if kind != MATTER_V4:
        return kind, warnings, reasons

    if registry is None:
        warnings.append("登记表不存在；迁移将新建 Registry v2 并写入本 Matter")
        return REGISTRY_ENTRY_MISSING, warnings, reasons
    if not registry_io.is_v2(registry):
        reasons.append("Registry 仍为 v1（matter_id 尚未成为主键）")
        return PARTIAL_REGISTRY_V1, warnings, reasons
    if registry_entry is None or not registry_io.matter_entry_present(registry, matter_id or ""):
        warnings.append("Registry v2 中缺少本 Matter 条目；将补登记")
        return REGISTRY_ENTRY_MISSING, warnings, reasons
    reasons.append("Registry v2 已含本 Matter 条目")
    return MATTER_V4, warnings, reasons


def _name_conflicts(names: dict[str, Any]) -> str | None:
    """§15：来源冲突时按明确优先级选择，但必须显式告警并列出全部候选值。"""

    values = [value for value in names.values() if isinstance(value, str) and value]
    if len(set(values)) <= 1:
        return None
    detail = "；".join(f"{key}={value}" for key, value in names.items() if isinstance(value, str) and value)
    return f"legacy name sources disagree（{detail}）；已按 state → registry → directory 优先级选择"


def _select_name(names: dict[str, Any]) -> str | None:
    """§15 优先级：state.case_name → registry name → directory basename。"""

    for key in ("state", "registry", "directory"):
        value = names.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _name_resolution(inspection: dict[str, Any]) -> dict[str, Any]:
    """列出全部候选值与最终采用值（Gate 1：按优先级选择，但必须显式可审计）。

    Matter Name ≠ Matter Identity：名称冲突不 hard stop，只告警。
    """

    candidates = {
        key: value for key, value in inspection["name_sources"].items() if isinstance(value, str) and value
    }
    conflicts = len(set(candidates.values())) > 1
    return {
        "candidates": candidates,
        "selected": inspection["selected_name"],
        "priority": ["state.case_name", "registry.name", "directory"],
        "conflict": conflicts,
        "warning": "legacy name sources disagree；已按优先级选择，未静默覆盖任何来源" if conflicts else "",
    }


def resolve_plan_identity(plan: dict[str, Any], *, generator: Callable[[], str] | None = None) -> str:
    """把 plan 的 Matter ID 意图解析为唯一 ID；**只允许生成一次**。

    - `existing`          → 复用 plan 中的既有 ID（resume 绝不重新生成）；
    - `generate-on-apply` → 调用一次 generator 生成 UUID，并回填进 plan，
                            此后整个事务（matter.yaml / state / registry / journal）
                            都必须使用同一个已解析 ID。

    回填后 intent 变为 `existing`，因此重复调用幂等，不会产生第二个 ID。
    """

    intent = plan.get("matter_id_intent") or {}
    kind = intent.get("kind")
    if kind == MATTER_ID_EXISTING:
        value = intent.get("value")
        if not isinstance(value, str) or not value.strip():
            raise MigrationPartialState("plan 声明复用既有 Matter ID，但未提供有效值")
        # 即使复用既有 ID，也必须回填计划各处：
        # 续跑时计划是新构建的，占位符可能还留在 matter.yaml / registry / index 里。
        plan["proposed_matter_id"] = value
        backfill_plan_identity(plan, value)
        return value
    if kind != MATTER_ID_GENERATE_ON_APPLY:
        raise MigrationPartialState(f"未知的 Matter ID intent：{kind!r}")
    create = generator or (lambda: str(uuid.uuid4()))
    resolved = create()
    plan["matter_id_intent"] = {"kind": MATTER_ID_EXISTING, "value": resolved}
    plan["proposed_matter_id"] = resolved
    backfill_plan_identity(plan, resolved)
    return resolved


def backfill_plan_identity(plan: dict[str, Any], matter_id: str) -> None:
    """把已解析的 Matter ID 注入计划的**每一处**：matter.yaml / state / registry / index。

    任何一处仍留着占位符，都会导致事务内出现两个身份。
    """

    document = plan.get("matter_yaml")
    if isinstance(document, dict):
        document["matter"]["id"] = matter_id
    state = plan.get("planned_state")
    if isinstance(state, dict):
        state["matter_id"] = matter_id
    registry = plan.get("planned_registry")
    if isinstance(registry, dict):
        for key in ("matters", "cases"):
            for item in registry.get(key) or []:
                if isinstance(item, dict) and item.get("matter_id") == WILL_GENERATE:
                    item["matter_id"] = matter_id
    placeholder = (plan.get("index_changes") or {}).get("id_placeholder")
    if placeholder and isinstance(plan.get("planned_index"), str):
        plan["planned_index"] = plan["planned_index"].replace(placeholder, matter_id.split("-", 1)[0])


def stamp_plan_time(plan: dict[str, Any], timestamp: str) -> None:
    """把 --apply 的时刻注入计划中的时间字段；与 `resolve_plan_identity` 对称。

    plan 本身不取时钟（因此 dry-run 可重复，§59），所有时间占位符在此一次性盖章。
    """

    today = timestamp[:10]
    document = plan.get("matter_yaml")
    if isinstance(document, dict):
        metadata = document.get("metadata")
        if isinstance(metadata, dict):
            metadata["created_at"] = timestamp
            metadata["updated_at"] = timestamp
            migration = metadata.get("migration")
            if isinstance(migration, dict):
                migration["migrated_at"] = timestamp
    registry = plan.get("planned_registry")
    if isinstance(registry, dict):
        if registry.get("updated_at") == PLAN_TIME_PLACEHOLDER:
            registry["updated_at"] = today
        for key in ("matters", "cases"):
            for item in registry.get(key) or []:
                if isinstance(item, dict) and item.get("updated_at") == PLAN_TIME_PLACEHOLDER:
                    item["updated_at"] = today
    if isinstance(plan.get("planned_index"), str):
        plan["planned_index"] = plan["planned_index"].replace(PLAN_TIME_PLACEHOLDER, today)

    # 快照目录名同样依赖 apply 时刻：在此算出**实际会创建**的路径，
    # 使 dry-run 预告与事务落盘的目录完全一致（否则运维会去找一个不存在的目录）。
    snapshot = plan.get("snapshot")
    if isinstance(snapshot, dict) and snapshot.get("directory"):
        base = Path(snapshot["directory"]).parent
        snapshot["directory"] = str(base / snapshot_dirname(plan["case_dir"], timestamp))

    plan["writer"] = {**plan.get("writer", {}), "stamped_at": timestamp}


def journal_path(root: str | Path, case_dir: str | Path) -> Path:
    """每个案件一份 migration journal，避免与其它案件的未完成事务互相覆盖。"""

    digest = hashlib.sha256(str(Path(case_dir).resolve()).encode("utf-8")).hexdigest()[:12]
    return Path(root) / SNAPSHOT_DIRNAME / f"journal-{digest}.json"


def load_journal(root: str | Path, case_dir: str | Path) -> dict[str, Any] | None:
    """读取该案件的事务日志；结构非法一律按 partial 处理，不猜。"""

    path = journal_path(root, case_dir)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MigrationPartialState(f"迁移日志无法读取，需人工检查：{path}: {exc}") from exc
    if not isinstance(data, dict):
        raise MigrationPartialState(f"迁移日志结构非法：{path}")
    return data


def legacy_identity(case_dir: str | Path, registry_entry: dict[str, Any] | None = None) -> dict[str, Any]:
    """记录"这个目录当初是哪个案件"的内容指纹（不只是路径）。

    journal 复用 Matter ID 时，路径相同并不足以证明是同一个案件——
    目录可能被删除后换成另一个旧案。因此身份必须绑定内容。
    """

    case = Path(case_dir)
    notes = case / NOTES_FILENAME
    state = case / STATE_FILENAME
    identity: dict[str, Any] = {"case_path": str(case.resolve())}
    if state.exists():
        identity["state_sha256"] = file_digest(state)
    if notes.exists():
        identity["note_sha256"] = file_digest(notes)
    if isinstance(registry_entry, dict):
        identity["registry_entry"] = {
            "name": registry_entry.get("name"),
            "product_dir": registry_entry.get("product_dir"),
        }
    return identity


def verify_journal_identity(journal: dict[str, Any], case_dir: str | Path) -> list[str]:
    """确认当前目录仍是当初那条事务的对象；返回不匹配原因（空列表 = 通过）。

    可用锚点（迁移从不修改这些内容）：

    - `case_path` 必须完全一致；
    - `matter.yaml` 已存在时，其 `matter.id` 必须等于 journal 记录的 ID（最强锚点）；
    - `matter.yaml` 不存在时，state 必须仍是**未改写**的原件，其 sha256 必须匹配；
    - 案件笔记若被记录且仍存在，sha256 必须匹配。
    """

    case = Path(case_dir)
    problems: list[str] = []
    recorded_path = journal.get("case_path")
    if recorded_path and recorded_path != str(case.resolve()):
        problems.append(f"journal.case_path={recorded_path} 与当前目录不一致")

    identity = journal.get("legacy_identity") or {}
    matter_file = case / MATTER_FILENAME
    state_file = case / STATE_FILENAME
    notes_file = case / NOTES_FILENAME

    if matter_file.exists():
        try:
            document = load_matter(matter_file)
            current_id = document["matter"]["id"]
        except MatterError as exc:
            problems.append(f"matter.yaml 无法用于身份校验：{exc}")
        else:
            if current_id != journal.get("matter_id"):
                problems.append(
                    f"matter.yaml id={current_id} 与 journal.matter_id={journal.get('matter_id')} 不一致"
                )
    else:
        expected = identity.get("state_sha256")
        if not expected:
            problems.append("journal 缺少 legacy_identity.state_sha256，无法证明案件身份")
        elif not state_file.exists():
            problems.append("既无 matter.yaml 也无 _case_state.json，无法证明案件身份")
        elif file_digest(state_file) != expected:
            problems.append("_case_state.json 与 journal 记录的内容指纹不一致")

    expected_note = identity.get("note_sha256")
    if expected_note and notes_file.exists() and file_digest(notes_file) != expected_note:
        problems.append("00-案件笔记.md 与 journal 记录的内容指纹不一致")
    return problems


_ZULU_RE = re.compile(r"[Zz]$")
_SHORT_OFFSET_RE = re.compile(r"([+-]\d{2})(\d{2})$")


def snapshot_stamp(stamp: str) -> str:
    """把 apply 时刻规范化为快照目录名里的 **UTC** 时间戳（`%Y-%m-%dT%H%M%SZ`）。

    为什么用 UTC 而不是本地偏移（2026-09-19 修，3.2.2）：

    旧实现用 `.replace("+", "-")` 让文件名「安全」，结果把 `+0800` 写成了 `-0800`——
    而 `-0800` 在 ISO-8601 里明确表示 UTC−8，与真实偏移**相差 16 小时**。
    这种「看起来完全合法、含义却相反」的 metadata 比格式难看更危险：
    运维照目录名判断快照时间会读错；而且在 UTC−8 机器上同一个名字反而是对的，
    **同一套命名在不同时区语义不同**。

    快照属于系统事务 metadata，用 UTC：跨时区稳定、排序稳定、无 +/- 转义问题、
    不与 ISO-8601 语义冲突。权威时间始终是 `manifest.created_at` 与 journal 的
    `started_at`（保留本地偏移，不受本函数影响）。

    **先归一化再解析**：`Z` 结尾与 `+0800`（无冒号）这两种 ISO-8601 写法
    Python 3.11 才支持 `fromisoformat` 解析，直接解析会让同一份输入在
    3.9/3.10 与 3.11+ 上得到**不同的目录名**——那就等于把本次要消除的
    「同一时刻不同名字」又请了回来。故在此自行补齐成 `+00:00` / `+08:00` 形式。

    占位符原样返回：未盖章的 dry-run 必须保持可重复（§59）。
    其余无法解析的输入**直接报错**，不原样落进目录名——静默写出一个
    含义可疑的名字，正是 3.2.2 修掉的那类问题。
    """

    if stamp == PLAN_TIME_PLACEHOLDER:
        return stamp

    normalized = _ZULU_RE.sub("+00:00", stamp)
    normalized = _SHORT_OFFSET_RE.sub(r"\1:\2", normalized)
    try:
        parsed = datetime.datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"快照时间戳无法解析，拒绝生成目录名：{stamp!r}") from exc
    if parsed.tzinfo is None:
        # 无偏移的时间不做机器时区推断，一律按 UTC 处理：结果与运行环境无关
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")


def snapshot_dirname(case_dir: str | Path, stamp: str) -> str:
    """迁移快照目录名：带案件指纹，避免同一秒内多案迁移撞名。

    plan 与事务共用本函数，保证 dry-run 预告的目录与实际创建的一致。

    **已产生的旧快照不改名**：journal 按绝对路径引用它们，改名会切断
    journal↔snapshot 链路。UTC 命名规则只作用于此后新建的快照，
    因此 `.migration/` 下允许新旧两种命名并存。
    """

    suffix = hashlib.sha256(str(Path(case_dir).resolve()).encode("utf-8")).hexdigest()[:8]
    return f"{SNAPSHOT_LABEL}-{snapshot_stamp(stamp)}-{suffix}"


def source_hashes(plan: dict[str, Any]) -> dict[str, str]:
    """记录 plan 所依赖的源文件指纹。

    4C 在写入前后各核对一次：源文件在 plan → commit 之间被改动必须 hard stop（§39）。
    """

    case_dir = Path(plan["case_dir"])
    root = Path(plan["product_root"])
    candidates = [
        case_dir / STATE_FILENAME,
        case_dir / MATTER_FILENAME,
        root / registry_io.REGISTRY_FILENAME,
        root / registry_io.INDEX_FILENAME,
    ]
    return {str(path): file_digest(path) for path in candidates if path.exists()}


# --- Plan -----------------------------------------------------------------


def build_plan(
    inspection: dict[str, Any],
    *,
    actor: str = "unknown",
) -> dict[str, Any]:
    """构造迁移计划。dry-run 与 apply 共用本函数（红线五）。"""

    mode = inspection["mode"]
    kind = inspection["kind"]
    if mode == MODE_NOOP:
        raise MigrationNotNeeded(f"该案件已是完整 Matter，无需迁移：{inspection['case_dir']}")
    if mode == MODE_BLOCKED:
        raise _blocked_error(inspection)

    case_path = Path(inspection["case_dir"])
    root = Path(inspection["product_root"])
    selected_name = inspection["selected_name"]
    existing_matter_id = inspection["matter_id"]
    matter_id = existing_matter_id or WILL_GENERATE
    # Matter ID 意图是 plan 的一等语义（Gate 1 决定）：apply 只解析一次，不重新规划。
    matter_id_intent = (
        {"kind": MATTER_ID_EXISTING, "value": existing_matter_id}
        if existing_matter_id
        else {"kind": MATTER_ID_GENERATE_ON_APPLY}
    )

    if mode == MODE_MIGRATE:
        planned_state, state_changes, state_warnings = _plan_state(inspection, matter_id=WILL_GENERATE)
    elif mode == MODE_RESUME:
        planned_state, state_changes, state_warnings = _plan_state(
            inspection, matter_id=existing_matter_id
        )
    else:  # MODE_RESUME_REGISTRY
        planned_state = inspection["state"]
        state_changes = []
        state_warnings = []

    planned_matter = _plan_matter(inspection, matter_id=matter_id, actor=actor)
    planned_registry, registry_changes, registry_warnings = _plan_registry(
        inspection, matter_id=matter_id, selected_name=selected_name
    )
    index_changes, planned_index = _plan_index(inspection, matter_id=matter_id, selected_name=selected_name)

    warnings = list(inspection["warnings"]) + state_warnings + registry_warnings
    warnings.extend(_classification_warnings())

    plan = {
        "case_dir": str(case_path),
        "product_root": str(root),
        "kind": kind,
        "mode": mode,
        "legacy_case_name": selected_name,
        "name_sources": inspection["name_sources"],
        "name_resolution": _name_resolution(inspection),
        "source_state_version": inspection["state_version"],
        "target_state_version": STATE_SCHEMA_VERSION,
        "matter_id_intent": matter_id_intent,
        "proposed_matter_id": matter_id,
        "matter_id_source": "复用既有 matter.yaml 的 ID（resume 不重新生成）" if existing_matter_id else "将在 --apply 时生成",
        "matter_yaml": planned_matter,
        "planned_state": planned_state,
        "state_changes": state_changes,
        "planned_registry": planned_registry,
        "registry_changes": registry_changes,
        "index_changes": index_changes,
        "planned_index": planned_index,
        "source_hashes": source_hashes({"case_dir": str(case_path), "product_root": str(root)}),
        "legacy_identity": legacy_identity(case_path, inspection.get("registry_entry")),
        "snapshot": _snapshot_plan(inspection),
        "backup_files": _backup_files(inspection),
        "preserved": _preserved(inspection),
        "not_touched": _not_touched(),
        "warnings": warnings,
        "errors": [],
        "actor": actor,
        # writer 元数据在 --apply 落盘时盖章；plan 本身不带时间戳，
        # 否则 dry-run 不可重复（Phase 4B 契约：时间不进 transform）。
        "writer": {"harness": actor, "operation_id": "matter-migration", "stamped_at": "apply"},
        "built_at": _timestamp(),
    }
    _validate_plan(plan)
    return plan


def _blocked_error(inspection: dict[str, Any]) -> MatterError:
    kind = inspection["kind"]
    where = inspection["case_dir"]
    if kind == CORRUPTED_MATTER:
        return MatterIdConflict(
            "Matter identity conflict\n"
            f"Matter Root: {where}\n"
            f"matter.yaml id: {inspection['matter_id']}\n"
            f"state matter_id: {inspection['state_matter_id']}"
        )
    if kind == SUSPICIOUS_V4_WITHOUT_MATTER:
        return MigrationPartialState(
            f"{where} 的 state 已是 v4 但没有 {MATTER_FILENAME}；无法证明 matter_id 的来源，"
            "拒绝自动生成 Matter Identity。请人工确认该 state 的来源后处理。"
        )
    if kind == UNSUPPORTED_STATE:
        version = inspection["state_version"]
        supported = "、".join(str(item) for item in SUPPORTED_STATE_SCHEMA_VERSIONS)
        return MatterSchemaUnsupported(
            f"不支持的案件状态 schema_version：{version!r}；迁移只支持 v3 → v4（当前支持 {supported}）。"
            "禁止降级；低于 v3 的 state 请先用 upgrade_case_state.py 升到 v3。"
        )
    if kind == STATE_MISSING:
        return MatterStateMissing(
            f"Matter structure incomplete：{where} 缺少 {STATE_FILENAME}；"
            "迁移不依据案件笔记自动创建 state。"
        )
    return MigrationSourceInvalid(f"不是可迁移的案件目录：{where}")


def _classification_warnings() -> list[str]:
    return [
        "matter.type → unclassified（不从名称、目录或材料推断案件类型）",
        "engagement.role → unknown（不推断律师团队正式角色）",
        "procedure.kind / stage → unknown（不推断程序类型与阶段）",
        "modules → []（不自动启用 Matter Module）",
    ]


def _plan_state(
    inspection: dict[str, Any],
    *,
    matter_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """调用冻结的纯变换；时间与 writer 元数据不进 transform（Phase 4B 契约）。"""

    if not isinstance(inspection["state"], dict):
        raise MigrationSourceInvalid(f"缺少可迁移的 state：{inspection['case_dir']}")
    result = migrate_state_v3_to_v4(
        inspection["state"],
        matter_id=None if matter_id == WILL_GENERATE else matter_id,
    )
    planned = result.state
    if matter_id == WILL_GENERATE:
        planned["matter_id"] = WILL_GENERATE
    return planned, result.changes, result.warnings


def _plan_matter(inspection: dict[str, Any], *, matter_id: str, actor: str) -> dict[str, Any]:
    """§14 的 matter.yaml 目标形状；字段全部来自已冻结的 Matter Schema v1。"""

    state = inspection["state"] if isinstance(inspection["state"], dict) else {}
    case_tier = state.get("case_tier")
    stamp = PLAN_TIME_PLACEHOLDER  # 时间由 --apply 盖章，plan 保持确定性
    return {
        "schema_version": 1,
        "matter": {
            "id": matter_id,
            "code": None,
            "name": inspection["selected_name"],
            "aliases": [],  # §16：不把目录名/registry name 自动塞进 aliases
            "type": "unclassified",
            "subtypes": [],
            "status": "active",
        },
        # Gate 1 决定：jurisdiction 属 Matter identity，legacy 迁移一律留空，
        # 不因为"目前主要做中国法律工作"就把未知写成 CN。null = unknown。
        "jurisdiction": {"country": None, "province": None, "city": None, "court": None},
        "engagement": {"role": "unknown", "represented_party": None},
        "procedure": {"kind": "unknown", "stage": "unknown"},
        "governance": {"case_tier": case_tier if case_tier in {"routine", "complex", "critical"} else None},
        "modules": [],
        "bindings": {},
        "metadata": {
            "created_at": stamp,
            "updated_at": stamp,
            "created_by": actor,
            "migration": {  # §46：Schema 的 metadata 允许扩展
                "source": "casebench-2.x/state-v3",
                "migrated_at": stamp,
            },
        },
    }


def _plan_registry(
    inspection: dict[str, Any],
    *,
    matter_id: str,
    selected_name: str,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    root = Path(inspection["product_root"])
    warnings: list[str] = []
    registry = inspection["registry"]
    before_version = registry_io.registry_version(registry)

    if registry is None:
        warnings.append("Registry entry missing → will create Registry v2")
    elif not registry_io.is_v2(registry):
        warnings.append("Registry 仍为 v1 → will upgrade to v2")

    planned = registry_io.upgrade_to_v2_shell(registry, root)
    entry = registry_io.build_matter_entry(
        matter_id=matter_id,
        name=selected_name,
        root=root,
        matter_type="unclassified",
        role="unknown",
        procedure_stage="unknown",
        status="active",
        updated_at=PLAN_TIME_PLACEHOLDER,
    )
    registry_io.upsert_matter_entry(planned, entry, PLAN_TIME_PLACEHOLDER)

    changes = {
        "schema_version": {"from": before_version, "to": registry_io.SUPPORTED_REGISTRY_VERSION},
        "entry": {"action": "upsert", "matter_id": matter_id, "name": selected_name},
        "other_entries_preserved": True,
    }
    return planned, changes, warnings


def _plan_index(
    inspection: dict[str, Any],
    *,
    matter_id: str,
    selected_name: str,
) -> tuple[dict[str, Any], str]:
    index_path = Path(inspection["index_path"])
    current = index_path.read_text(encoding="utf-8") if index_path.exists() else None
    short_id = matter_id.split("-", 1)[0] if matter_id != WILL_GENERATE else INDEX_ID_PLACEHOLDER
    entry = {
        "matter_id": short_id,
        "name": selected_name,
        "type": "unclassified",
        "role": "unknown",
        "stage": "unknown",
        "status": "active",
        "updated_at": PLAN_TIME_PLACEHOLDER,
    }
    planned = registry_io.update_index(
        None if current is None else _index_without_row(current, short_id), entry
    )
    changes = {
        "path": str(index_path),
        "action": "create" if current is None else "append_or_update_row",
        "id_placeholder": INDEX_ID_PLACEHOLDER,
        "note": "_INDEX.md 不是 Source of Truth；写失败不改变 Matter Identity",
    }
    return changes, planned


def _index_without_row(text: str, short_id: str) -> str:
    """重算计划时先去掉同一 Matter 的旧行，保证 dry-run 可重复（§59）。"""

    lines = text.splitlines(keepends=True)
    return "".join(
        line
        for line in lines
        if not (line.startswith("| ") and len(line.split("|")) > 1 and line.split("|")[1].strip() == short_id)
    )


def _snapshot_plan(inspection: dict[str, Any]) -> dict[str, Any]:
    """§35：迁移快照位置。时间戳由 --apply 决定，因此这里显示命名模式。"""

    root = Path(inspection["product_root"])
    pattern = snapshot_dirname(inspection["case_dir"], PLAN_TIME_PLACEHOLDER)
    return {
        "directory": str(root / SNAPSHOT_DIRNAME / pattern),
        "manifest": "manifest.json",
        "status": "planned",
    }


def _backup_files(inspection: dict[str, Any]) -> list[dict[str, str]]:
    """只备份会被本次迁移修改的 metadata（§34），不复制整个案件目录。"""

    targets: list[tuple[str, Path]] = []
    if inspection["mode"] in (MODE_MIGRATE, MODE_RESUME):
        targets.append(("_case_state.json", Path(inspection["case_dir"]) / STATE_FILENAME))
    if inspection["mode"] in (MODE_MIGRATE, MODE_RESUME, MODE_RESUME_REGISTRY):
        targets.append(("_registry.json", Path(inspection["registry_path"])))
        targets.append(("_INDEX.md", Path(inspection["index_path"])))
    return [{"role": role, "path": str(path)} for role, path in targets if path.exists()]


def _preserved(inspection: dict[str, Any]) -> dict[str, Any]:
    state = inspection["state"] if isinstance(inspection["state"], dict) else {}
    counts = {
        key: len(state.get(key) or [])
        for key in ("facts", "issues", "pending_items", "reviews", "research_artifacts",
                    "analysis_artifacts", "handoff_history")
    }
    counts["notes"] = 1 if inspection["has_notes"] else 0
    counts["unknown_top_level_fields"] = sorted(
        key
        for key in state
        if key
        not in {
            "schema_version", "matter_id", "case_name", "case_tier", "updated_at", "facts", "issues",
            "pending_items", "reviews", "research_artifacts", "analysis_artifacts", "last_writer",
            "handoff_history", "sequences",
        }
    )
    return counts


def _not_touched() -> list[str]:
    return [
        "00-案件笔记.md",
        "Research Artifact 文件与登记内容",
        "Analysis Artifact 文件、SHA256 与 stale 状态",
        "01-过程稿/",
        "02-定稿/",
        "案件材料目录（bindings 不自动绑定）",
    ]


# 不变量集合：全局恒定，模式相关按本轮 mutation scope 取舍（Gate 1 决定）。
GLOBAL_INVARIANTS = (
    "matter_document_valid",
    "state_is_object",
    "identity_consistent",
    "registry_matter_ids_unique",
)
STATE_REWRITE_INVARIANTS = (
    "state_schema_v4",
    "issue_shape",
    "sequences_recorded",
)


def mode_invariants(mode: str) -> tuple[str, ...]:
    """本轮 mutation 决定校验范围：只修 Registry 时不要求 State 完成结构升级。"""

    if mode in (MODE_MIGRATE, MODE_RESUME):
        return GLOBAL_INVARIANTS + STATE_REWRITE_INVARIANTS
    return GLOBAL_INVARIANTS


def post_validate(plan: dict[str, Any], snapshot: dict[str, Any] | None = None) -> list[str]:
    """按 `plan.mode` 校验结果快照；硬失败抛 MigrationValidationFailed，返回 warnings。

    4A 传入的是 **planned** 快照；4C 落盘后必须用同一函数校验**磁盘上的真实快照**，
    从而保证 dry-run 与 apply 的校验口径完全一致。

    快照结构：{"matter": document, "state": state, "registry": registry}
    """

    if snapshot is None:
        snapshot = {
            "matter": plan["matter_yaml"],
            "state": plan["planned_state"],
            "registry": plan["planned_registry"],
        }
    invariants = mode_invariants(plan["mode"])
    errors: list[str] = []
    warnings: list[str] = []

    document = snapshot.get("matter")
    state = snapshot.get("state")
    registry = snapshot.get("registry")

    if "matter_document_valid" in invariants:
        try:
            probe = {
                **document,
                "matter": {**document["matter"], "id": str(uuid.uuid4())},  # 仅校验用，绝不写入、绝不展示
            }
            validate_matter_document(probe)
        except MatterCredentialLeak:
            raise
        except MatterError as exc:
            errors.append(f"matter.yaml 校验失败：{exc}")

    if "state_is_object" in invariants and not isinstance(state, dict):
        errors.append("state 不是对象")

    if "identity_consistent" in invariants and isinstance(document, dict) and isinstance(state, dict):
        document_id = document.get("matter", {}).get("id")
        state_id = state.get("matter_id")
        if document_id == WILL_GENERATE or state_id == WILL_GENERATE:
            # dry-run：ID 尚未生成，身份一致性由 apply 时的 resolve_plan_identity 保证。
            warnings.append("Matter ID 尚未生成（dry-run）；身份一致性将在 --apply 时校验")
        elif state_id is not None and document_id is not None and state_id != document_id:
            errors.append(
                "Matter identity conflict\n"
                f"matter.yaml id: {document_id}\nstate matter_id: {state_id}"
            )

    if "registry_matter_ids_unique" in invariants and isinstance(registry, dict):
        seen: set[str] = set()
        for item in registry.get("matters") or []:
            if not isinstance(item, dict):
                continue
            value = item.get("matter_id")
            if isinstance(value, str) and value:
                if value in seen:
                    errors.append(f"Registry 出现重复 matter_id：{value}")
                seen.add(value)

    if "state_schema_v4" in invariants and isinstance(state, dict):
        if state.get("schema_version") != STATE_SCHEMA_VERSION:
            errors.append(f"state schema_version 必须是 {STATE_SCHEMA_VERSION}")

    if "issue_shape" in invariants and isinstance(state, dict):
        issue_errors, issue_warnings = validate_issues(state)
        errors.extend(issue_errors)
        warnings.extend(issue_warnings)

    if "sequences_recorded" in invariants and isinstance(state, dict):
        sequences = state.get("sequences")
        if not isinstance(sequences, dict):
            errors.append("state 缺少 sequences")

    if errors:
        raise MigrationValidationFailed("迁移校验失败：\n- " + "\n- ".join(errors))
    return warnings


def _validate_plan(plan: dict[str, Any]) -> None:
    """§11：plan 自身先校验；错误不得留到 apply 才暴露。

    只修 Registry 的模式不改写 state：源 state 既有的结构问题属"既有状况"，
    迁移无权修理，也不应据此阻塞登记修复——如实提示即可（Gate 1 决定）。
    """

    warnings = post_validate(plan)
    plan["warnings"].extend(warnings)

    if plan["mode"] not in (MODE_MIGRATE, MODE_RESUME):
        state = plan["planned_state"]
        if isinstance(state, dict):
            issue_errors, _ = validate_issues(state)
            plan["warnings"].extend(
                f"源 state 既有问题（本次不改写 state，未修复）：{item}" for item in issue_errors
            )
    plan["errors"] = []


# --- 渲染（§53） -----------------------------------------------------------


def render_plan(plan: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("Migration plan (dry-run)")
    lines.append("")
    lines.append(f"Case:        {plan['case_dir']}")
    lines.append(f"Classified:  {plan['kind']} — {KIND_LABELS[plan['kind']]}")
    lines.append(f"Mode:        {plan['mode']}")
    resolution = plan["name_resolution"]
    lines.append("Matter name candidates:")
    for key, value in resolution["candidates"].items():
        lines.append(f"  {key}: {value}")
    lines.append(f"  SELECTED: {resolution['selected']}")
    intent = plan["matter_id_intent"]
    intent_label = (
        f"generate-on-apply（--apply 时生成一次）"
        if intent["kind"] == MATTER_ID_GENERATE_ON_APPLY
        else f"existing（复用 {intent['value']}）"
    )
    lines.append(f"Matter ID:   {plan['proposed_matter_id']}")
    lines.append(f"  intent: {intent_label}")
    lines.append(f"State:       v{plan['source_state_version']} → v{plan['target_state_version']}")
    lines.append("")

    creates = ["matter.yaml"] if plan["mode"] == MODE_MIGRATE else []
    mods = []
    if plan["mode"] in (MODE_MIGRATE, MODE_RESUME):
        mods.append(f"_case_state.json  v{plan['source_state_version']} → v{plan['target_state_version']}")
    registry_from = plan["registry_changes"]["schema_version"]["from"]
    mods.append(
        "registry  %s → v%s"
        % (
            "v1 (legacy，无 schema_version)" if registry_from is None else f"v{registry_from}",
            plan["registry_changes"]["schema_version"]["to"],
        )
    )
    mods.append(f"_INDEX.md  {plan['index_changes']['action']}")

    def section(title: str, items: list[str]) -> None:
        lines.append(f"{title}:")
        lines.extend(f"- {item}" for item in items or ["(none)"])
        lines.append("")

    section("WILL CREATE", creates)
    section("WILL MODIFY", mods)

    preserved = plan["preserved"]
    section(
        "WILL PRESERVE",
        [
            f"{preserved['facts']} facts（零重写：不重编号、不重分类、不清洗）",
            f"{preserved['issues']} issues",
            f"{preserved['pending_items']} pending items",
            f"{preserved['research_artifacts']} research artifacts（登记原样保留）",
            f"{preserved['analysis_artifacts']} analysis artifacts（登记原样保留）",
            f"{preserved['reviews']} reviews / {preserved['handoff_history']} handoff",
            f"{preserved['notes']} 00-案件笔记.md",
        ]
        + ([f"未知顶层字段：{', '.join(preserved['unknown_top_level_fields'])}"]
           if preserved["unknown_top_level_fields"] else []),
    )
    section("WILL NOT TOUCH", plan["not_touched"])

    if plan["state_changes"]:
        lines.append("State changes:")
        for change in plan["state_changes"]:
            lines.append(f"- {change['field']}: {change.get('from', '(none)')} → {change.get('to', '(none)')}")
        lines.append("")

    section("WARNING", plan["warnings"])
    section("ERROR", plan["errors"])

    lines.append("Backup (before any write):")
    lines.append(f"- snapshot dir: {plan['snapshot']['directory']}")
    for item in plan["backup_files"]:
        lines.append(f"- {item['role']}: {item['path']}")
    lines.append("")
    lines.append("Dry-run 未写入任何文件。正式写入需 --apply。")
    return "\n".join(lines)
