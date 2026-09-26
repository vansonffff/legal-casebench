#!/usr/bin/env python3
"""Matter Contract v1 的安全读取、校验、写入和根目录解析。"""

from __future__ import annotations

import datetime
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Iterable

try:
    from workspace_io import atomic_write, file_digest
except ModuleNotFoundError:  # pragma: no cover - 仅支持从任意工作目录导入
    _SCRIPT_DIR = Path(__file__).resolve().parent
    if str(_SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPT_DIR))
    from workspace_io import atomic_write, file_digest


MATTER_FILENAME = "matter.yaml"
STATE_FILENAME = "_case_state.json"
SUPPORTED_SCHEMA_VERSION = 1
SUPPORTED_TYPES = {
    "litigation",
    "bankruptcy",
    "non-litigation",
    "other",
    "unclassified",
}
SUPPORTED_CASE_TIERS = {"routine", "complex", "critical"}
# engagement.role 的规范 token（2026-09-19 冻结）。
# 展示层可以翻译（administrator → "管理人"），Contract 层只认这些 token：
# DSH 的 Perspective Match 直接依赖它们，自由文本（admin / manager / 管理人）会让匹配失效。
# `unknown` / `other` 是任何 type 都允许的兜底值。
ROLE_ESCAPE_HATCHES = {"unknown", "other"}
CANONICAL_ROLES: dict[str, set[str]] = {
    "litigation": {
        "plaintiff",
        "defendant",
        "third-party",
        "appellant",
        "respondent",
        "applicant",
        "respondent-to-application",
    },
    "bankruptcy": {
        "administrator",
        "debtor",
        "creditor",
        "investor",
        "restructuring-advisor",
    },
    # 非诉：沿用破产的**经济地位**角色，但去掉法院指定职务
    # （administrator 只在正式破产程序中有意义）。
    # 依据真实案件：非诉债务重组场景下我方可能是债务人，debtor 必须可用。
    "non-litigation": {
        "debtor",
        "creditor",
        "investor",
        "restructuring-advisor",
    },
    # 其他 / 未分类：只允许兜底值
    "other": set(),
    "unclassified": set(),
}
SUPPORTED_ROLES = set(ROLE_ESCAPE_HATCHES).union(*CANONICAL_ROLES.values())
STATE_SCHEMA_VERSION = 4
# v3 为存量旧案的只读兼容版本：可读写，用 `matter.py migrate` 升级为 v4；本模块不改写旧 state。
SUPPORTED_STATE_SCHEMA_VERSIONS = (3, 4)
MODULE_ID = re.compile(r"^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$")
ISSUE_ID_PATTERN = re.compile(r"^ISS-\d{4,}$")
PENDING_ITEM_ID_PATTERN = re.compile(r"^TASK-\d{4,}$")
ISSUE_REF_FIELDS = {
    "fact_refs": "事实",
    "research_refs": "检索成果",
    "analysis_refs": "专项分析",
}
# 引用前缀 → 归属字段。RES-/ANA- 为存量成果编号，同样不得落入 facts。
REF_PREFIX_FIELDS = {
    "FACT": "fact_refs",
    "F": "fact_refs",
    "RA": "research_refs",
    "RES": "research_refs",
    "AA": "analysis_refs",
    "ANA": "analysis_refs",
}
SENSITIVE_KEY = re.compile(
    r"(?:token|password|secret|cookie|api[-_]?key|access[-_]?token|"
    r"refresh[-_]?token|authorization|credential|client[-_]?secret)",
    re.IGNORECASE,
)
SENSITIVE_VALUE = re.compile(
    r"(?:bearer\s+\S+|(?:token|password|secret|cookie|api[-_]?key|"
    r"access[-_]?token|refresh[-_]?token)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)


class MatterError(ValueError):
    """所有 Matter Contract 错误的稳定基类。"""

    code = "MatterInvalid"


class MatterNotFound(MatterError):
    code = "MatterNotFound"


class MatterSchemaUnsupported(MatterError):
    code = "MatterSchemaUnsupported"


class MatterInvalid(MatterError):
    code = "MatterInvalid"


class MatterIdConflict(MatterError):
    code = "MatterIdConflict"


class MatterStateMissing(MatterInvalid):
    """Matter 结构不完整：有 matter.yaml 但没有 _case_state.json。

    继承 MatterInvalid，使既有捕获 MatterInvalid 的调用方无需改动；
    code 单独可辨，便于调用方区分"契约非法"与"结构不完整"。
    """

    code = "MatterStateMissing"


class MatterCredentialLeak(MatterError):
    code = "MatterCredentialLeak"


class MatterRegistryConflict(MatterError):
    code = "MatterRegistryConflict"


class MatterModuleConflict(MatterError):
    code = "MatterModuleConflict"


class LegacyMatterNeedsMigration(MatterError):
    code = "LegacyMatterNeedsMigration"


class MigrationError(MatterError):
    """迁移错误的稳定基类（源自 Phase 4 计划 §50）。"""

    code = "MigrationError"


class MigrationNotNeeded(MigrationError):
    code = "MigrationNotNeeded"


class MigrationSourceInvalid(MigrationError):
    code = "MigrationSourceInvalid"


class MigrationSourceChanged(MigrationError):
    code = "MigrationSourceChanged"


class MigrationBackupFailed(MigrationError):
    code = "MigrationBackupFailed"


class MigrationPartialState(MigrationError):
    code = "MigrationPartialState"


class MigrationRegistryAmbiguous(MigrationError):
    code = "MigrationRegistryAmbiguous"


class MigrationRegistryConflict(MigrationError):
    code = "MigrationRegistryConflict"


class MigrationValidationFailed(MigrationError):
    code = "MigrationValidationFailed"


class MigrationResumeRequired(MigrationError):
    code = "MigrationResumeRequired"


def _yaml_module():
    """加载 PyYAML；源码树内优先复用已随 Skillhub 提供的安全副本。"""

    try:
        import yaml  # type: ignore

        return yaml
    except ModuleNotFoundError:
        pass

    candidates = [
        Path(__file__).resolve().parents[4] / "scripts" / "vendor",
        Path(__file__).resolve().parent / "vendor",
    ]
    for candidate in candidates:
        if not (candidate / "yaml").is_dir():
            continue
        candidate_text = str(candidate)
        if candidate_text not in sys.path:
            sys.path.insert(0, candidate_text)
        try:
            import yaml  # type: ignore

            return yaml
        except ModuleNotFoundError:
            continue
    raise MatterInvalid(
        "Matter Contract 需要可用的 YAML 解析器；当前运行环境未提供 PyYAML，"
        "且技能包未找到随附的 vendor/yaml"
    )


def _load_yaml(path: Path) -> dict[str, Any]:
    yaml = _yaml_module()

    class UniqueLoader(yaml.SafeLoader):  # type: ignore[name-defined]
        def construct_mapping(self, node, deep=False):
            result = {}
            for key_node, value_node in node.value:
                key = self.construct_object(key_node, deep=deep)
                if not isinstance(key, (str, int, float, bool)) or key in result:
                    raise MatterInvalid(f"YAML 含重复或非法键：{path}")
                result[key] = self.construct_object(value_node, deep=deep)
            return result

    try:
        text = path.read_text(encoding="utf-8")
        tokens = yaml.scan(text)
        if any(
            isinstance(token, (yaml.tokens.AliasToken, yaml.tokens.AnchorToken))
            for token in tokens
        ):
            raise MatterInvalid("matter.yaml 不支持 YAML anchor 或 alias")
        value = yaml.load(text, Loader=UniqueLoader)
    except MatterError:
        raise
    except (OSError, UnicodeError) as exc:
        raise MatterInvalid(f"无法读取 Matter Contract：{path}: {exc}") from exc
    except yaml.YAMLError as exc:  # type: ignore[name-defined]
        raise MatterInvalid(f"matter.yaml YAML 格式无效：{exc}") from exc
    if not isinstance(value, dict):
        raise MatterInvalid("matter.yaml 顶层必须是映射")
    return value


def _dump_yaml(value: dict[str, Any]) -> bytes:
    yaml = _yaml_module()
    try:
        content = yaml.safe_dump(
            value,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
        )
    except yaml.YAMLError as exc:  # type: ignore[name-defined]
        raise MatterInvalid(f"无法生成 matter.yaml：{exc}") from exc
    return content.encode("utf-8")


def matter_path(target: str | Path) -> Path:
    """将 Matter 目录或 matter.yaml 路径归一化为 Contract 文件路径。"""

    candidate = Path(target).expanduser()
    if candidate.name == MATTER_FILENAME or candidate.suffix in {".yaml", ".yml"}:
        path = candidate
    elif candidate.exists() and candidate.is_file():
        path = candidate
    else:
        path = candidate / MATTER_FILENAME
    if path.is_symlink():
        raise MatterInvalid(f"拒绝读取符号链接 Matter Contract：{path}")
    path = path.resolve()
    if not path.exists():
        raise MatterNotFound(f"未找到 Matter Contract：{path}")
    if not path.is_file():
        raise MatterInvalid(f"Matter Contract 不是普通文件：{path}")
    return path


def _path_error(path: str, message: str) -> str:
    return f"{path}: {message}"


def _require_mapping(value: Any, path: str, errors: list[str]) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        errors.append(_path_error(path, "必须是映射"))
        return None
    return value


def _require_string(value: Any, path: str, errors: list[str], *, nonempty: bool = False) -> None:
    if not isinstance(value, str) or (nonempty and not value.strip()):
        errors.append(_path_error(path, "必须是非空字符串" if nonempty else "必须是字符串"))


def _validate_string_list(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, list):
        errors.append(_path_error(path, "必须是列表"))
        return
    for index, item in enumerate(value):
        _require_string(item, f"{path}[{index}]", errors)


def _scan_credentials(value: Any, path: str = "") -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            if SENSITIVE_KEY.search(str(key)):
                return child_path
            found = _scan_credentials(child, child_path)
            if found:
                return found
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found = _scan_credentials(child, f"{path}[{index}]")
            if found:
                return found
    elif isinstance(value, str) and SENSITIVE_VALUE.search(value):
        return path or "<value>"
    return None


def _validate_document(document: dict[str, Any]) -> None:
    errors: list[str] = []
    schema_version = document.get("schema_version")
    if isinstance(schema_version, bool) or not isinstance(schema_version, int):
        errors.append("schema_version: 必须是整数 1")
    elif schema_version != SUPPORTED_SCHEMA_VERSION:
        raise MatterSchemaUnsupported(
            f"不支持的 Matter schema_version：{schema_version}；当前支持 {SUPPORTED_SCHEMA_VERSION}"
        )

    matter = _require_mapping(document.get("matter"), "matter", errors)
    if matter is not None:
        for key in ("id", "name", "type"):
            if key not in matter:
                errors.append(_path_error(f"matter.{key}", "缺少必填字段"))
        if "id" in matter:
            value = matter["id"]
            try:
                parsed = uuid.UUID(value) if isinstance(value, str) else None
            except (ValueError, AttributeError):
                parsed = None
            if parsed is None or not isinstance(value, str) or str(parsed) != value.lower():
                errors.append(_path_error("matter.id", "必须是规范 UUID"))
        if "name" in matter:
            _require_string(matter["name"], "matter.name", errors, nonempty=True)
        if "code" in matter and matter["code"] is not None:
            _require_string(matter["code"], "matter.code", errors)
        if "aliases" in matter:
            _validate_string_list(matter["aliases"], "matter.aliases", errors)
        if "type" in matter:
            if not isinstance(matter["type"], str) or matter["type"] not in SUPPORTED_TYPES:
                errors.append(
                    _path_error(
                        "matter.type",
                        "必须是 litigation、bankruptcy、non-litigation、other 或 unclassified",
                    )
                )
        if "subtypes" in matter:
            _validate_string_list(matter["subtypes"], "matter.subtypes", errors)
        if "status" in matter:
            _require_string(matter["status"], "matter.status", errors, nonempty=True)

    for section in ("jurisdiction", "engagement", "procedure", "governance", "metadata"):
        if section in document:
            _require_mapping(document[section], section, errors)

    matter_type: str | None = None
    if isinstance(matter, dict) and isinstance(matter.get("type"), str):
        matter_type = matter["type"]

    engagement = document.get("engagement")
    if isinstance(engagement, dict) and "role" in engagement:
        role = engagement["role"]
        _require_string(role, "engagement.role", errors, nonempty=True)
        if isinstance(role, str) and role:
            allowed = CANONICAL_ROLES.get(matter_type or "", set()) | ROLE_ESCAPE_HATCHES
            if role not in allowed:
                errors.append(
                    _path_error(
                        "engagement.role",
                        f"{role!r} 不是 type={matter_type or '未声明'} 的规范角色；"
                        f"允许：{'、'.join(sorted(allowed))}（见 references/matter-vocabulary.md）",
                    )
                )
    if isinstance(engagement, dict) and "represented_party" in engagement:
        if engagement["represented_party"] is not None:
            _require_string(engagement["represented_party"], "engagement.represented_party", errors)

    procedure = document.get("procedure")
    if isinstance(procedure, dict):
        for key in ("kind", "stage"):
            if key in procedure and procedure[key] is not None:
                _require_string(procedure[key], f"procedure.{key}", errors)

    governance = document.get("governance")
    if isinstance(governance, dict) and "case_tier" in governance:
        tier = governance["case_tier"]
        if tier is not None and (not isinstance(tier, str) or tier not in SUPPORTED_CASE_TIERS):
            errors.append(_path_error("governance.case_tier", "必须是 routine、complex、critical 或 null"))

    modules = document.get("modules")
    if modules is not None:
        if not isinstance(modules, list):
            errors.append("modules: 必须是列表")
        else:
            hashable_modules = [module for module in modules if isinstance(module, str)]
            if len(set(hashable_modules)) != len(hashable_modules):
                errors.append("modules: 不得包含重复 Module ID")
            for index, module in enumerate(modules):
                if not isinstance(module, str) or not MODULE_ID.fullmatch(module):
                    errors.append(_path_error(f"modules[{index}]", "不是合法 Module ID"))

    bindings = document.get("bindings")
    if bindings is not None:
        if not isinstance(bindings, dict):
            errors.append("bindings: 必须是映射")
        else:
            for key, value in bindings.items():
                if not isinstance(value, dict):
                    errors.append(_path_error(f"bindings.{key}", "必须是映射"))

    credential_path = _scan_credentials(document)
    if credential_path:
        raise MatterCredentialLeak(f"Matter Contract 含疑似凭据字段或认证值：{credential_path}")
    if errors:
        raise MatterInvalid("Matter Contract 校验失败：\n- " + "\n- ".join(errors))


def validate_matter_document(document: dict[str, Any]) -> None:
    """在内存中校验 Matter Contract 文档（不读盘、不写盘）。

    供 migration 在 dry-run 阶段校验"计划生成的 matter.yaml"。
    """

    if not isinstance(document, dict):
        raise MatterInvalid("Matter Contract 必须是映射")
    _validate_document(document)


def load_matter(target: str | Path) -> dict[str, Any]:
    """读取并校验 matter.yaml，保留所有未知字段。"""

    path = matter_path(target)
    document = _load_yaml(path)
    _validate_document(document)
    return document


def state_path_for(target: str | Path) -> Path:
    """将 Matter 目录或状态文件路径归一化为 `_case_state.json` 路径。"""

    candidate = Path(target).expanduser()
    if candidate.name == STATE_FILENAME:
        candidate = candidate.parent
    return candidate / STATE_FILENAME


def load_state(target: str | Path) -> dict[str, Any]:
    """读取 `_case_state.json`；不修改文件，保留所有未知字段。"""

    path = state_path_for(target)
    if path.is_symlink():
        raise MatterInvalid(f"拒绝读取符号链接案件状态：{path}")
    if not path.exists():
        # matter.yaml 回答"我是谁"，_case_state.json 回答"我现在怎么样"；
        # 只有 matter.yaml 说明 Matter 结构不完整，不是"合法但略欠完整"。
        raise MatterStateMissing(
            f"Matter structure incomplete：未找到 {STATE_FILENAME}（{path}）；"
            f"Matter 托管案件必须同时具备 {MATTER_FILENAME} 与 {STATE_FILENAME}"
        )
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MatterInvalid(f"无法读取案件状态：{path}: {exc}") from exc
    if not isinstance(state, dict):
        raise MatterInvalid(f"案件状态必须是 JSON 对象：{path}")
    return state


def _identity_conflict_message(root: Path, expected: str, actual: str) -> str:
    """身份冲突信息只暴露 Matter Root 与两个 ID，不含 binding 内容。"""

    return (
        "Matter identity conflict\n"
        f"Matter Root: {Path(root).expanduser().resolve()}\n"
        f"matter.yaml id: {expected}\n"
        f"state matter_id: {actual}"
    )


def assert_matter_state_match(
    root: str | Path,
    state: dict[str, Any],
    document: dict[str, Any] | None = None,
    *,
    strict: bool = True,
) -> list[str]:
    """校验 State 与 Matter 身份一致，返回兼容性提示。

    strict=True 用于写入侧：缺失 matter_id 或 state 版本低于 v4 一律 hard stop，
    不自动升级、不重写 state、不重建 Matter ID。
    strict=False 用于读取侧校验：旧 state 只报告兼容性提示，身份冲突仍 hard stop。
    """

    root = Path(root).expanduser()
    document = document if document is not None else load_matter(root)
    expected = document["matter"]["id"]
    warnings: list[str] = []

    version = state.get("schema_version")
    if version is None:
        warnings.append(f"{STATE_FILENAME} 未声明 schema_version；按 legacy 状态处理")
    elif isinstance(version, bool) or not isinstance(version, int):
        raise MatterSchemaUnsupported(
            f"案件状态 schema_version 必须是整数：{state_path_for(root)}"
        )
    elif version not in SUPPORTED_STATE_SCHEMA_VERSIONS:
        supported = "、".join(str(item) for item in SUPPORTED_STATE_SCHEMA_VERSIONS)
        raise MatterSchemaUnsupported(
            f"不支持的案件状态 schema_version：{version}；当前支持 {supported}"
        )

    state_id = state.get("matter_id")
    if state_id is None or (isinstance(state_id, str) and not state_id.strip()):
        message = (
            f"{STATE_FILENAME} 缺少 matter_id（schema v{version}）；"
            "State v3 → v4 需显式迁移（matter.py migrate），不自动升级，也不写入 Matter 托管状态"
        )
        if strict:
            raise LegacyMatterNeedsMigration(message)
        warnings.append(message + "；等待 State v4 migration")
    elif not isinstance(state_id, str):
        raise MatterInvalid(f"{STATE_FILENAME}.matter_id 必须是字符串")
    elif state_id != expected:
        raise MatterIdConflict(_identity_conflict_message(root, expected, state_id))
    elif version != STATE_SCHEMA_VERSION:
        message = (
            f"Matter 托管状态应为 schema v{STATE_SCHEMA_VERSION}，当前为 v{version}；拒绝降级写入"
        )
        if strict:
            raise MatterSchemaUnsupported(message)
        warnings.append(message)

    case_name = state.get("case_name")
    if isinstance(case_name, str) and case_name != document["matter"]["name"]:
        warnings.append(f"{STATE_FILENAME}.case_name 与 matter.yaml.matter.name 不同；未自动覆盖")
    return warnings


def load_matter_state(
    start: str | Path,
    workspace_root: str | Path | None = None,
    *,
    strict: bool = True,
) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    """解析 Matter Root、读取 Contract 与状态，并完成身份预检。

    返回 (matter_root, matter_document, state)。写入侧应使用 strict=True。
    """

    root = resolve_matter_root(start, workspace_root)
    document = load_matter(root)
    state = load_state(root)
    assert_matter_state_match(root, state, document, strict=strict)
    return root, document, state


def _next_sequence(
    records: Iterable[Any],
    key: str,
    pattern: re.Pattern[str],
    prefix: str,
    high_water: int = 0,
) -> str:
    """分配下一个稳定编号；忽略 malformed 记录，且绝不与任何既存字符串重名。

    `high_water` 是已分配编号的高水位（见 `recorded_sequence`）：Issue 被删除后
    其编号不再出现在记录中，只靠 max+1 会回收旧号，因此必须叠加高水位。
    """

    highest = high_water if isinstance(high_water, int) and not isinstance(high_water, bool) else 0
    highest = max(highest, 0)
    used: set[str] = set()
    for item in records or []:
        if not isinstance(item, dict):
            continue
        value = item.get(key)
        if not isinstance(value, str):
            continue
        used.add(value)
        if pattern.fullmatch(value):
            highest = max(highest, int(value.rsplit("-", 1)[1]))
    candidate = highest + 1
    while True:
        allocated = f"{prefix}-{candidate:04d}"
        if allocated not in used:
            return allocated
        candidate += 1


def recorded_sequence(state: dict[str, Any], key: str) -> int:
    """读取 `sequences` 高水位；缺失或结构异常时按 0 处理。"""

    sequences = state.get("sequences")
    if not isinstance(sequences, dict):
        return 0
    value = sequences.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def record_sequence(state: dict[str, Any], key: str, allocated: str) -> None:
    """把已分配编号写入 `sequences` 高水位，保证删除后不回收编号。"""

    if not isinstance(allocated, str) or "-" not in allocated:
        raise MatterInvalid(f"无法记录的编号：{allocated!r}")
    tail = allocated.rsplit("-", 1)[1]
    if not tail.isdigit():
        raise MatterInvalid(f"无法记录的编号：{allocated!r}")
    sequences = state.setdefault("sequences", {})
    if not isinstance(sequences, dict):
        raise MatterInvalid("sequences 必须是映射")
    number = int(tail)
    current = sequences.get(key)
    if isinstance(current, bool) or not isinstance(current, int) or current < number:
        sequences[key] = number


def next_issue_id(issues: Iterable[Any], high_water: int = 0) -> str:
    """分配下一个 Issue ID；不复用、不回收已删除编号。"""

    return _next_sequence(issues, "issue_id", ISSUE_ID_PATTERN, "ISS", high_water)


def next_pending_item_id(items: Iterable[Any], high_water: int = 0) -> str:
    """分配下一个 Pending Item ID（TASK-0001）；不连接任何外部任务系统。"""

    return _next_sequence(items, "item_id", PENDING_ITEM_ID_PATTERN, "TASK", high_water)


def now_timestamp() -> str:
    """统一的本地时区时间戳；状态字段时间只经此函数生成。"""

    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def new_issue(
    issue_id: str,
    title: str,
    *,
    status: str = "active",
    category: str = "",
    fact_refs: list[str] | None = None,
    research_refs: list[str] | None = None,
    analysis_refs: list[str] | None = None,
    current_position: dict[str, Any] | None = None,
    actor: str = "unknown",
) -> dict[str, Any]:
    """构造 State v4 Issue；标题可改，issue_id 是稳定身份。"""

    if not ISSUE_ID_PATTERN.fullmatch(issue_id or ""):
        raise MatterInvalid(f"非法 Issue ID：{issue_id!r}；格式为 ISS-0001")
    if not isinstance(title, str) or not title.strip():
        raise MatterInvalid("Issue title 必须是非空字符串")
    if title.strip() == issue_id:
        raise MatterInvalid("Issue title 不得与 issue_id 相同")
    stamp = now_timestamp()
    position = dict(current_position) if isinstance(current_position, dict) else {}
    position.setdefault("summary", "")
    position.setdefault("confidence", "unknown")
    return {
        "issue_id": issue_id,
        "title": title.strip(),
        "status": status,
        "category": category,
        "fact_refs": list(fact_refs or []),
        "research_refs": list(research_refs or []),
        "analysis_refs": list(analysis_refs or []),
        "current_position": position,
        "counterarguments": [],
        "evidence_gaps": [],
        "next_actions": [],
        "created_at": stamp,
        "updated_at": stamp,
        "created_by": actor,
    }


def new_pending_item(
    item_id: str,
    title: str,
    *,
    issue_ref: str = "",
    status: str = "open",
) -> dict[str, Any]:
    """构造标准 Pending Item；仅结构化字段，不同步任何外部任务系统。"""

    if not PENDING_ITEM_ID_PATTERN.fullmatch(item_id or ""):
        raise MatterInvalid(f"非法 Pending Item ID：{item_id!r}；格式为 TASK-0001")
    if not isinstance(title, str) or not title.strip():
        raise MatterInvalid("Pending Item title 必须是非空字符串")
    if issue_ref and not ISSUE_ID_PATTERN.fullmatch(issue_ref):
        raise MatterInvalid(f"issue_ref 必须是 Issue ID：{issue_ref!r}")
    return {"item_id": item_id, "title": title.strip(), "issue_ref": issue_ref, "status": status}


def ref_target_field(ref: str) -> str:
    """按前缀判定引用归属，防止把检索成果或专项分析写进 facts。"""

    if not isinstance(ref, str) or "-" not in ref:
        raise MatterInvalid(f"无法判定引用类型：{ref!r}；请使用 FACT-/RA-/AA- 前缀")
    field = REF_PREFIX_FIELDS.get(ref.split("-", 1)[0].upper())
    if field is None:
        raise MatterInvalid(f"无法判定引用类型：{ref!r}；请使用 FACT-/RA-/AA- 前缀")
    return field


def validate_issues(state: dict[str, Any]) -> tuple[list[str], list[str]]:
    """校验 issues 结构与引用关系，返回 (errors, warnings)。

    Error：issues 非数组、issue_id 缺失/格式非法/重复、title 与 issue_id 相同。
    Warning：refs 重复、refs 指向的目标尚未登记（dangling）。
    """

    errors: list[str] = []
    warnings: list[str] = []
    issues = state.get("issues")
    if issues is None:
        return errors, warnings
    if not isinstance(issues, list):
        return ["issues: 必须是数组"], warnings

    def identifiers(key: str, collection: str) -> set[str]:
        found: set[str] = set()
        items = state.get(collection)
        if not isinstance(items, list):
            return found
        for item in items:
            if isinstance(item, dict):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    found.add(value)
        return found

    pools = {
        "fact_refs": identifiers("fact_id", "facts"),
        "research_refs": identifiers("artifact_id", "research_artifacts"),
        "analysis_refs": identifiers("artifact_id", "analysis_artifacts"),
    }
    seen: dict[str, str] = {}
    for index, issue in enumerate(issues):
        where = f"issues[{index}]"
        if not isinstance(issue, dict):
            errors.append(f"{where}: 必须是对象")
            continue
        issue_id = issue.get("issue_id")
        if issue_id is None:
            errors.append(f"{where}.issue_id: 缺少稳定 Issue ID")
        elif not isinstance(issue_id, str) or not ISSUE_ID_PATTERN.fullmatch(issue_id):
            errors.append(f"{where}.issue_id: 格式必须为 ISS-0001 形式")
        elif issue_id in seen:
            errors.append(f"重复 issue_id：{issue_id}（{seen[issue_id]} 与 {where}）")
        else:
            seen[issue_id] = where
        title = issue.get("title")
        if isinstance(title, str) and isinstance(issue_id, str) and title.strip() == issue_id:
            errors.append(f"{where}.title: 不得与 issue_id 相同")

        for field, label in ISSUE_REF_FIELDS.items():
            refs = issue.get(field)
            if refs is None:
                continue
            if not isinstance(refs, list):
                errors.append(f"{where}.{field}: 必须是数组")
                continue
            strings = [ref for ref in refs if isinstance(ref, str)]
            for ref in refs:
                if not isinstance(ref, str) or not ref.strip():
                    errors.append(f"{where}.{field}: 引用必须是非空字符串")
            duplicated = sorted({ref for ref in strings if strings.count(ref) > 1})
            if duplicated:
                warnings.append(f"{where}.{field}: 存在重复引用 {', '.join(duplicated)}")
            for ref in strings:
                if ref not in pools[field]:
                    warnings.append(f"{where}.{field}: {label}引用目标尚未登记（dangling）{ref}")
    return errors, warnings


def sequence_warnings(state: dict[str, Any]) -> list[str]:
    """校验 `sequences` 高水位结构；异常时编号按 0 处理，只报告提示。"""

    sequences = state.get("sequences")
    if sequences is None:
        return []
    if not isinstance(sequences, dict):
        return ["sequences: 必须是映射；编号高水位按 0 处理"]
    warnings: list[str] = []
    for key in ("issue", "pending_item"):
        value = sequences.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            warnings.append(f"sequences.{key}: 必须是非负整数；编号高水位按 0 处理")
    return warnings


def validate_matter(target: str | Path) -> list[str]:
    """完整校验 Matter Contract 与状态身份，返回不改变文件的兼容性提示。

    结构不完整（有 matter.yaml 无 _case_state.json）与身份冲突都是 hard error；
    只有 legacy 兼容与 dangling 引用等情形才降级为 warning。
    """

    path = matter_path(target)
    document = load_matter(path)
    root = path.parent
    # load_state 在缺状态文件时抛 MatterStateMissing：Matter 结构不完整属 Error。
    state = load_state(root)
    warnings = assert_matter_state_match(root, state, document, strict=False)
    if state.get("matter_id"):
        errors, issue_warnings = validate_issues(state)
        if errors:
            raise MatterInvalid("案件状态校验失败：\n- " + "\n- ".join(errors))
        warnings.extend(issue_warnings)
        from casebench_v4 import validate_extensions

        extension_errors = validate_extensions(state)
        if extension_errors:
            raise MatterInvalid("案件状态校验失败：\n- " + "\n- ".join(extension_errors))
    warnings.extend(sequence_warnings(state))
    return warnings


def write_matter(
    target: str | Path,
    document: dict[str, Any],
    expected_sha256: str | None = None,
) -> Path:
    """校验后原子写入 Matter Contract；未知字段由调用方传入并原样保留。"""

    if not isinstance(document, dict):
        raise MatterInvalid("Matter Contract 必须是映射")
    _validate_document(document)
    target_path = Path(target).expanduser()
    if target_path.name != MATTER_FILENAME:
        target_path = target_path / MATTER_FILENAME
    if target_path.is_symlink():
        raise MatterInvalid(f"拒绝覆盖符号链接 Matter Contract：{target_path}")
    target_path = target_path.resolve()
    current = file_digest(target_path)
    if expected_sha256 is not None and current != expected_sha256:
        raise MatterInvalid(f"Matter Contract 已变化，拒绝覆盖：{target_path}")
    atomic_write(target_path, _dump_yaml(document), current if target_path.exists() else None)
    return target_path


def generate_matter_id() -> str:
    return str(uuid.uuid4())


def resolve_matter_root(
    start: str | Path,
    workspace_root: str | Path | None = None,
) -> Path:
    """从 start 向上解析最近的合法 Matter Root。"""

    start_path = Path(start).expanduser()
    if start_path.name == MATTER_FILENAME or (start_path.exists() and start_path.is_file()):
        start_path = start_path.parent
    start_path = start_path.resolve()
    boundary = Path(workspace_root).expanduser().resolve() if workspace_root else None
    if boundary and not start_path.is_relative_to(boundary):
        raise MatterInvalid(f"Matter resolution 起点越过 workspace root：{start_path}")

    current = start_path
    while True:
        candidate = current / MATTER_FILENAME
        if candidate.exists():
            if candidate.is_symlink() or not candidate.is_file():
                raise MatterInvalid(f"Matter Contract 不是普通文件：{candidate}")
            load_matter(candidate)
            return current
        if boundary and current == boundary:
            break
        parent = current.parent
        if parent == current:
            break
        if boundary and not parent.is_relative_to(boundary):
            break
        current = parent
    raise MatterNotFound(f"从 {start_path} 到边界未找到 {MATTER_FILENAME}")
