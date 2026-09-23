#!/usr/bin/env python3
"""Phase 4C/4F：可恢复的多文件迁移事务（Backup / Commit / Resume）。

Phase 4 计划 §34–§49 的落点。核心事实：`matter.yaml` + state + registry + index
**无法做成文件系统级单一原子事务**，因此本模块实现的是
**可恢复的 staged migration transaction**，而不是假装 ACID。

## 顺序（§37 / §42）

```text
acquire lock(root) → lock(case)        ← 顺序固定，全仓不存在反向获取
  ↓
hash preflight（源文件是否在 plan 之后被改动）
  ↓
backup（快照 + manifest，初始 snapshot_status=invalid）
  ↓
再次确认 source hash → 通过才把快照标为 valid
  ↓
resolve matter identity + stamp time（各只做一次，续跑沿用首次的值）
  ↓
matter.yaml → state v4 → registry v2 → index
  ↓
post_validate(plan.mode, 磁盘快照)
  ↓
mark complete
```

## 崩溃与恢复的四条硬约束（Gate 2 决定）

1. **journal 必须绑定案件内容身份**，不能只绑路径：复用 Matter ID 前要证明
   当前目录仍是当初那条事务的对象（`verify_journal_identity`）。
2. **备份窗口内的源变化会让快照失效**：只有备份完成且二次 hash 通过，
   快照才被标为 `valid`；否则标为 `invalid`，且不得作为可信恢复点。
3. **写入成功但 journal 尚未落盘就崩**：续跑不得盲写，必须先比对该步骤的
   实际产物是否已等于目标内容（`step_matches`），相等则补记 journal 后跳过。
4. **快照必须支持完整恢复**：manifest 记录每个 mutation target 的
   `preexisting`，恢复时对"迁移前不存在"的文件执行删除。

## 其他

- **不自动回滚**（§49 是"可以尝试"而非必须）：`matter.yaml` 一旦写入，
  Matter ID 即已确立，回滚会丢弃可能已被引用的身份。
- **快照不是灾备**：它与案件工作区同处一个存储介质，只防迁移失败，
  不防磁盘损坏/文件系统故障。真正的灾备需要独立介质。
"""

from __future__ import annotations

import datetime
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any, Callable

import registry_io
from matter_io import (
    MATTER_FILENAME,
    STATE_FILENAME,
    MatterCredentialLeak,
    MatterError,
    MigrationBackupFailed,
    MigrationPartialState,
    MigrationSourceChanged,
    MigrationSourceInvalid,
    load_matter,
    load_state,
    write_matter,
)
from matter_migration import (
    MATTER_ID_EXISTING,
    MODE_MIGRATE,
    MODE_RESUME,
    MODE_RESUME_REGISTRY,
    journal_path,
    load_journal,
    post_validate,
    resolve_plan_identity,
    snapshot_dirname,
    source_hashes,
    stamp_plan_time,
    verify_journal_identity,
)
from workspace_io import atomic_write, dump_json_bytes, file_digest, workspace_lock

JOURNAL_VERSION = 1
MIGRATION_LABEL = "matter-v1"
MIGRATION_DIRNAME = ".migration"

SNAPSHOT_PENDING = "invalid"
SNAPSHOT_VALID = "valid"
SNAPSHOT_INVALID = "invalid"


def _timestamp() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


# --- journal ---------------------------------------------------------------


def save_journal(root: Path, case_dir: Path, journal: dict[str, Any]) -> None:
    path = journal_path(root, case_dir)
    journal["updated_at"] = _timestamp()
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, dump_json_bytes(journal), file_digest(path))


# --- mutation targets 与快照（§34–§36） ------------------------------------


def mutation_targets(plan: dict[str, Any]) -> list[tuple[str, Path]]:
    """本次事务**会创建或修改**的全部文件。

    与"存在的文件"不同：`matter.yaml` 在迁移前通常不存在，但它仍是 mutation target，
    恢复时必须删除它——否则"恢复到迁移前"无法表达。
    """

    case_dir = Path(plan["case_dir"])
    root = Path(plan["product_root"])
    mode = plan["mode"]
    targets: list[tuple[str, Path]] = []
    if mode == MODE_MIGRATE:
        targets.append((MATTER_FILENAME, case_dir / MATTER_FILENAME))
    if mode in (MODE_MIGRATE, MODE_RESUME):
        targets.append((STATE_FILENAME, case_dir / STATE_FILENAME))
    targets.append((registry_io.REGISTRY_FILENAME, root / registry_io.REGISTRY_FILENAME))
    targets.append((registry_io.INDEX_FILENAME, Path(plan["index_changes"]["path"])))
    return targets


def create_snapshot(plan: dict[str, Any], parent: Path, stamp: str) -> dict[str, Any]:
    """建立迁移快照与 manifest；任何失败都不得让迁移继续（红线六）。

    快照初始为 `invalid`：只有备份完成**且**二次 hash 确认源未变，才升为 `valid`。
    """

    parent = Path(parent)
    # 目录名带案件指纹：同一秒内迁移多个案件时不会互相撞名，
    # 同一案件续跑则复用 journal 里记录的目录（§60 不产生第二份快照）。
    # 命名与 plan 的预告共用 snapshot_dirname()，避免两者不一致。
    session = parent / snapshot_dirname(plan["case_dir"], stamp)
    entries: list[dict[str, Any]] = []
    try:
        session.mkdir(parents=True, exist_ok=False)
        for role, target in mutation_targets(plan):
            preexisting = target.exists()
            entry: dict[str, Any] = {
                "role": role,
                "original_path": str(target),
                "preexisting": preexisting,
                "backup_path": None,
                "sha256": None,
            }
            if preexisting:
                backup = session / role
                shutil.copy2(target, backup)
                entry["backup_path"] = str(backup)
                entry["sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
            entries.append(entry)
        manifest = {
            "migration": MIGRATION_LABEL,
            "journal_version": JOURNAL_VERSION,
            "created_at": stamp,
            "case_dir": plan["case_dir"],
            "mode": plan["mode"],
            "snapshot_status": SNAPSHOT_PENDING,
            "files": entries,
        }
        atomic_write(session / "manifest.json", dump_json_bytes(manifest), None)
    except (OSError, shutil.Error) as exc:
        raise MigrationBackupFailed(f"迁移快照创建失败，迁移未开始：{session}: {exc}") from exc
    return {"directory": str(session), "manifest": str(session / "manifest.json"), "files": entries}


def set_snapshot_status(snapshot: dict[str, Any], status: str, reason: str = "") -> None:
    """更新 manifest 的 snapshot_status；invalid 的快照不得作为可信恢复点。"""

    manifest_path = snapshot.get("manifest")
    if not manifest_path:
        return
    path = Path(manifest_path)
    if not path.exists():
        return
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["snapshot_status"] = status
    if reason:
        manifest["snapshot_status_reason"] = reason
    atomic_write(path, dump_json_bytes(manifest), file_digest(path))
    snapshot["snapshot_status"] = status


def snapshot_status(snapshot_dir: str | Path) -> str:
    manifest_path = Path(snapshot_dir) / "manifest.json"
    if not manifest_path.exists():
        return "missing"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return "unreadable"
    return str(manifest.get("snapshot_status") or "unknown")


def restore_guidance(snapshot_dir: str | Path) -> str:
    """§48：只提供 metadata backup + 人工恢复指引，不提供 `--rollback`。

    指引必须足以**完整**恢复：迁移前不存在的文件要删除，而不是留空。
    """

    session = Path(snapshot_dir)
    manifest_path = session / "manifest.json"
    status = snapshot_status(session)
    lines = [f"快照目录：{session}（snapshot_status={status}）"]
    if status != SNAPSHOT_VALID:
        lines.append(
            "  ⚠ 该快照未通过一致性确认，**不得**作为可信恢复点；"
            "它可能不是同一时间点的一致视图。请以案件材料与笔记为准人工核对。"
        )
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            manifest = {}
        actions: list[str] = []
        for item in manifest.get("files") or []:
            if not isinstance(item, dict):
                continue
            target = item.get("original_path")
            if item.get("preexisting"):
                actions.append(
                    f"  恢复 {target}\n    ← 用 {item.get('backup_path')}（sha256={item.get('sha256')}）"
                )
            else:
                actions.append(f"  删除 {target}\n    （迁移前不存在，恢复时必须删除）")
        if actions:
            lines.append("完整恢复步骤（逐项执行）：")
            lines.extend(actions)
    lines.append("  manifest.json 记录了每个文件的 original_path / preexisting / sha256。")
    return "\n".join(lines)


def verify_snapshot_manifest(snapshot_dir: str | Path) -> list[str]:
    """校验快照自身（§36）：manifest 里的 sha256 必须与备份副本一致。"""

    session = Path(snapshot_dir)
    manifest_path = session / "manifest.json"
    if not manifest_path.exists():
        return [f"快照缺少 manifest.json：{session}"]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return [f"manifest.json 无法读取：{exc}"]
    problems: list[str] = []
    for entry in manifest.get("files") or []:
        if not isinstance(entry, dict) or not entry.get("preexisting"):
            continue
        backup_path = Path(entry.get("backup_path") or "")
        if not backup_path.exists():
            problems.append(f"备份文件缺失：{backup_path}")
            continue
        if hashlib.sha256(backup_path.read_bytes()).hexdigest() != entry.get("sha256"):
            problems.append(f"备份文件校验失败：{backup_path}")
    return problems


# --- hash preflight（§39） -------------------------------------------------


def verify_source_hashes(plan: dict[str, Any]) -> None:
    """源文件在 plan → commit 之间被改动时必须 hard stop（§39 / Test 22）。"""

    expected = plan.get("source_hashes") or {}
    current = source_hashes(plan)
    if set(current) != set(expected):
        raise MigrationSourceChanged(
            "迁移源文件集合已变化（plan 与当前磁盘不一致）；请重新执行 dry-run。\n"
            f"plan:  {sorted(expected)}\nnow:   {sorted(current)}"
        )
    changed = [path for path, digest in expected.items() if current.get(path) != digest]
    if changed:
        raise MigrationSourceChanged(
            "迁移源文件在 dry-run 之后被改动；请重新执行 dry-run 后再提交。\n- " + "\n- ".join(changed)
        )


# --- 写入步骤（§42）与幂等比对（Gate 2 约束 3） ----------------------------


def _state_payload(plan: dict[str, Any], stamp: str, actor: str) -> dict[str, Any]:
    state = dict(plan["planned_state"])
    state["last_writer"] = {"harness": actor, "written_at": stamp, "operation_id": "matter-migration"}
    return state


def write_matter_step(plan: dict[str, Any]) -> dict[str, Any]:
    path = write_matter(Path(plan["case_dir"]), plan["matter_yaml"])
    return {"path": str(path), "sha256": file_digest(path)}


def write_state_step(plan: dict[str, Any], stamp: str, actor: str) -> dict[str, Any]:
    path = Path(plan["case_dir"]) / STATE_FILENAME
    baseline = file_digest(path) if path.exists() else None
    atomic_write(path, dump_json_bytes(_state_payload(plan, stamp, actor)), baseline)
    return {"path": str(path), "sha256": file_digest(path)}


def write_registry_step(plan: dict[str, Any]) -> dict[str, Any]:
    path = Path(plan["product_root"]) / registry_io.REGISTRY_FILENAME
    baseline = file_digest(path) if path.exists() else None
    atomic_write(path, dump_json_bytes(plan["planned_registry"]), baseline)
    return {"path": str(path), "sha256": file_digest(path)}


def write_index_step(plan: dict[str, Any]) -> dict[str, Any]:
    path = Path(plan["index_changes"]["path"])
    baseline = file_digest(path) if path.exists() else None
    atomic_write(path, plan["planned_index"].encode("utf-8"), baseline)
    return {"path": str(path), "sha256": file_digest(path)}


def steps_for_mode(mode: str) -> list[str]:
    """§42 的写入顺序；matter.yaml 先写，因为 Matter ID 的权威身份首先建立。"""

    if mode == MODE_MIGRATE:
        return ["backup", "matter_yaml", "state", "registry", "index"]
    if mode == MODE_RESUME:
        return ["backup", "state", "registry", "index"]
    if mode == MODE_RESUME_REGISTRY:
        return ["backup", "registry", "index"]
    raise MigrationPartialState(f"不可执行的迁移模式：{mode}")


def step_matches(name: str, plan: dict[str, Any], *, stamp: str, actor: str) -> bool:
    """该步骤的实际产物是否**已经等于**目标内容。

    用于覆盖"写入成功、journal 尚未落盘就崩"的窗口：此时不能盲写，也不能当成没做，
    而是比对磁盘现状后补记 journal。
    """

    try:
        if name == "matter_yaml":
            path = Path(plan["case_dir"]) / MATTER_FILENAME
            return path.exists() and load_matter(path) == plan["matter_yaml"]
        if name == "state":
            path = Path(plan["case_dir"]) / STATE_FILENAME
            return path.exists() and load_state(path) == _state_payload(plan, stamp, actor)
        if name == "registry":
            path = Path(plan["product_root"]) / registry_io.REGISTRY_FILENAME
            return path.exists() and registry_io.load_registry(path) == plan["planned_registry"]
        if name == "index":
            path = Path(plan["index_changes"]["path"])
            return path.exists() and path.read_text(encoding="utf-8") == plan["planned_index"]
    except (OSError, UnicodeError, MatterError, ValueError, json.JSONDecodeError):
        return False
    return False


def write_step(name: str, plan: dict[str, Any], *, stamp: str, actor: str) -> dict[str, Any]:
    writers: dict[str, Callable[[], dict[str, Any]]] = {
        "matter_yaml": lambda: write_matter_step(plan),
        "state": lambda: write_state_step(plan, stamp, actor),
        "registry": lambda: write_registry_step(plan),
        "index": lambda: write_index_step(plan),
    }
    if name not in writers:
        raise MigrationPartialState(f"未知的迁移步骤：{name}")
    return writers[name]()


# --- 结果快照与后校验（§54/§55） ------------------------------------------


def read_result_snapshot(plan: dict[str, Any]) -> dict[str, Any]:
    """从磁盘读回迁移结果，交给 post_validate 校验（与 dry-run 同一函数）。"""

    case_dir = Path(plan["case_dir"])
    root = Path(plan["product_root"])
    matter_file = case_dir / MATTER_FILENAME
    document: Any = None
    if matter_file.exists():
        document = load_matter(matter_file)
    state: Any = None
    try:
        state = load_state(case_dir)
    except MatterError:
        state = None
    return {
        "matter": document,
        "state": state,
        "registry": registry_io.load_registry(root / registry_io.REGISTRY_FILENAME),
    }


# --- 事务主体 -------------------------------------------------------------


def apply_plan(
    plan: dict[str, Any],
    *,
    actor: str,
    backup_parent: str | Path | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    """执行迁移计划。失败时停下来报告 partial 状态，不自动回滚。"""

    root = Path(plan["product_root"])
    case_dir = Path(plan["case_dir"])
    parent = Path(backup_parent) if backup_parent else root / MIGRATION_DIRNAME

    with workspace_lock(root), workspace_lock(case_dir):
        # 取得两把锁之后才做源预检：不得使用等待锁之前的旧判断。
        verify_source_hashes(plan)

        journal = load_journal(root, case_dir)
        resumable = bool(journal and journal.get("status") == "in_progress")
        if resumable:
            # Gate 2 约束 1：证明这条事务属于当前案件，才允许复用它的 ID 与快照。
            problems = verify_journal_identity(journal, case_dir)
            if problems:
                raise MigrationSourceInvalid(
                    "存在未结清的迁移日志，但它与当前案件不匹配，拒绝复用其 Matter ID：\n- "
                    + "\n- ".join(problems)
                    + f"\n请人工确认后删除或归档该日志：{journal_path(root, case_dir)}"
                )
            # 续跑沿用首次事务的时间戳：这样各步骤的目标内容在重试间保持逐字节一致，
            # 否则"比对磁盘现状"会永远不相等，约束 3 将失效。
            stamp = str(journal.get("started_at") or now or _timestamp())
            snapshot = {
                "directory": journal["snapshot_dir"],
                "manifest": journal.get("manifest"),
                "files": journal.get("files", []),
            }
        else:
            stamp = now or _timestamp()
            snapshot = create_snapshot(plan, parent, stamp)

        # 红线二：一个 legacy case 只能有一个 Matter ID。
        pinned = _pinned_matter_id(case_dir, journal if resumable else None)
        if pinned:
            plan["matter_id_intent"] = {"kind": MATTER_ID_EXISTING, "value": pinned}

        # §44：身份只解析一次；resume 时来自既有 matter.yaml，绝不重新生成。
        matter_id = resolve_plan_identity(plan)
        stamp_plan_time(plan, stamp)

        planned_steps = steps_for_mode(plan["mode"])
        journal = _new_journal(
            plan, matter_id, actor, snapshot, planned_steps, stamp, journal if resumable else None
        )

        # §37：备份之后、写入之前再确认一次源指纹。
        # Gate 2 约束 2：这一步没过，快照就不是可信恢复点，必须显式标为 invalid。
        try:
            verify_source_hashes(plan)
        except MigrationSourceChanged as exc:
            set_snapshot_status(snapshot, SNAPSHOT_INVALID, "备份窗口内源文件发生变化，快照不是一致视图")
            journal["snapshot_status"] = SNAPSHOT_INVALID
            journal["error"] = f"{type(exc).__name__}: {exc}"
            _mark_step(journal, {"name": "backup", "status": "done", "invalidated": True})
            save_journal(root, case_dir, journal)
            raise MigrationSourceChanged(
                f"{exc}\n\n注意：本次已生成的快照被标记为 invalid（{snapshot['directory']}），"
                "不得作为恢复点使用。"
            ) from exc
        set_snapshot_status(snapshot, SNAPSHOT_VALID)
        journal["snapshot_status"] = SNAPSHOT_VALID
        save_journal(root, case_dir, journal)

        for name in planned_steps:
            if _recorded_step(journal, name) == "done":
                continue
            # Gate 2 约束 3：覆盖"写成功但 journal 未落盘"的窗口——先比对，再决定写不写。
            if name != "backup" and step_matches(name, plan, stamp=stamp, actor=actor):
                _mark_step(journal, {"name": name, "status": "done", "at": _timestamp(), "recovered": True})
                save_journal(root, case_dir, journal)
                continue
            try:
                outcome = {"name": name, "status": "done", "at": _timestamp()}
                if name != "backup":
                    outcome.update(write_step(name, plan, stamp=stamp, actor=actor))
                _mark_step(journal, outcome)
            except MatterCredentialLeak:
                # 凭据泄漏是契约级硬错误，不该被包装成"可续跑的中断"。
                # 它在写盘之前就已拒绝，因此没有任何文件被改动。
                raise
            except (OSError, MatterError, ValueError, RuntimeError) as exc:
                _mark_step(journal, {"name": name, "status": "failed", "error": f"{type(exc).__name__}: {exc}"})
                # 状态保持 in_progress：这是"可续跑的中断"，不是终止。
                # 若标成 failed，下次运行会生成新 UUID 并再开一份快照，违反红线二与 §60。
                journal["failed_step"] = name
                journal["error"] = f"{type(exc).__name__}: {exc}"
                save_journal(root, case_dir, journal)
                raise MigrationPartialState(
                    f"迁移在步骤 {name} 失败，事务已停在可恢复状态（未回滚）。\n"
                    f"Matter ID: {matter_id}（已确立的身份不会被丢弃，续跑时复用）\n"
                    f"失败步骤：{name}\n原因：{exc}\n"
                    f"{restore_guidance(snapshot['directory'])}\n"
                    "修复原因后重新执行同一命令即可从断点续跑。"
                ) from exc
            save_journal(root, case_dir, journal)

        warnings = post_validate(plan, read_result_snapshot(plan))
        journal["status"] = "complete"
        journal["completed_at"] = _timestamp()
        journal["warnings"] = warnings
        save_journal(root, case_dir, journal)

    return {
        "status": "complete",
        "resumed": resumable,
        "matter_id": matter_id,
        "case_dir": str(case_dir),
        "mode": plan["mode"],
        "steps": [item["name"] for item in journal["steps"]],
        "snapshot": {**snapshot, "status": snapshot_status(snapshot["directory"])},
        "warnings": warnings,
    }


def _pinned_matter_id(case_dir: Path, journal: dict[str, Any] | None) -> str | None:
    """续跑时固定 Matter ID：优先 matter.yaml，其次上次事务日志。"""

    if (case_dir / MATTER_FILENAME).exists():
        return None  # 交给 resolve_plan_identity 走 existing 分支
    if not isinstance(journal, dict):
        return None
    recorded = journal.get("matter_id")
    if isinstance(recorded, str) and recorded.strip():
        return recorded
    return None


def _recorded_step(journal: dict[str, Any], name: str) -> str | None:
    for item in journal.get("steps") or []:
        if isinstance(item, dict) and item.get("name") == name:
            return item.get("status")
    return None


def _new_journal(
    plan: dict[str, Any],
    matter_id: str,
    actor: str,
    snapshot: dict[str, Any],
    steps: list[str],
    stamp: str,
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    if previous and previous.get("status") == "in_progress":
        merged = dict(previous)
        merged["status"] = "in_progress"
        merged["actor"] = actor
        merged["matter_id"] = matter_id
        return merged
    return {
        "journal_version": JOURNAL_VERSION,
        "migration": MIGRATION_LABEL,
        "case_path": str(Path(plan["case_dir"]).resolve()),
        "case_dir": plan["case_dir"],
        "matter_id": matter_id,
        "actor": actor,
        "started_at": stamp,
        "status": "in_progress",
        "legacy_identity": plan.get("legacy_identity", {}),
        "snapshot_dir": snapshot["directory"],
        "manifest": snapshot.get("manifest"),
        "files": snapshot.get("files", []),
        "snapshot_status": SNAPSHOT_PENDING,
        "source_hashes": plan.get("source_hashes", {}),
        "steps": [{"name": name, "status": "pending"} for name in steps],
    }


def _mark_step(journal: dict[str, Any], outcome: dict[str, Any]) -> None:
    steps = journal.setdefault("steps", [])
    for item in steps:
        if item.get("name") == outcome["name"]:
            item.clear()
            item.update(outcome)
            return
    steps.append(outcome)


def read_apply_status(root: str | Path, case_dir: str | Path) -> dict[str, Any] | None:
    """供 CLI / 诊断使用：读取该案件的事务状态。"""

    return load_journal(Path(root), Path(case_dir))


# --- 每案迁移审计报告（§106 / §107） ---------------------------------------


def build_migration_report(
    plan: dict[str, Any],
    result: dict[str, Any],
    *,
    validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """生成单案迁移审计报告；**只存 metadata，不做任何凭据输出**（§107）。

    字段对齐计划 §106：Matter ID、新旧 State 版本、原案名与 Matter 名、
    Registry 变化、备份位置、facts / issues / 成果登记计数、warnings、校验结果。
    """

    from workspace_io import sanitize

    case_dir = Path(plan["case_dir"])
    state: dict[str, Any] = {}
    state_file = case_dir / STATE_FILENAME
    if state_file.exists():
        try:
            state = load_state(case_dir)
        except MatterError:
            state = {}

    registry_path = Path(plan["product_root"]) / registry_io.REGISTRY_FILENAME
    registry = registry_io.load_registry(registry_path) or {}
    matter_entry = next(
        (
            item
            for item in registry.get("matters") or []
            if isinstance(item, dict) and item.get("matter_id") == result.get("matter_id")
        ),
        None,
    )
    registered = matter_entry is not None

    report = {
        "report_version": 1,
        "generated_at": _timestamp(),
        "matter_id": result.get("matter_id"),
        "case_dir": str(case_dir),
        "mode": plan["mode"],
        "resumed": result.get("resumed", False),
        "state_version": {"from": plan["source_state_version"], "to": plan["target_state_version"]},
        "case_name": {
            "legacy": plan["legacy_case_name"],
            "matter": plan["matter_yaml"]["matter"]["name"],
            "name_sources": plan["name_sources"],
            "conflict": bool(plan["name_resolution"]["conflict"]),
        },
        "registry": {
            "schema_version": registry.get("schema_version"),
            "registered": registered,
            "entry": {"name": (matter_entry or {}).get("name"), "type": (matter_entry or {}).get("type")},
            "cases_mirror_count": len(registry.get("cases") or []),
            "matters_count": len(registry.get("matters") or []),
        },
        "backup": {
            "directory": (result.get("snapshot") or {}).get("directory"),
            "status": (result.get("snapshot") or {}).get("status"),
        },
        "counts": {
            "facts": len(state.get("facts") or []),
            "issues": len(state.get("issues") or []),
            "pending_items": len(state.get("pending_items") or []),
            "research_artifacts": len(state.get("research_artifacts") or []),
            "analysis_artifacts": len(state.get("analysis_artifacts") or []),
            "reviews": len(state.get("reviews") or []),
        },
        "warnings": list(result.get("warnings") or []),
        "validation": validation or {},
    }
    problems = sanitize(report)
    if problems != report:  # pragma: no cover - 正常路径不会触发
        raise MigrationPartialState("迁移报告含疑似凭据字段，已拒绝写出（§107）")
    return report


def render_migration_report(report: dict[str, Any]) -> str:
    """把审计报告渲染成人类可读的 markdown（§106）。"""

    lines = [
        f"# Matter Migration Report · {report['case_name']['matter']}",
        "",
        f"- Matter ID: `{report['matter_id']}`",
        f"- Case: `{report['case_dir']}`",
        f"- Mode: {report['mode']}" + ("（resumed）" if report["resumed"] else ""),
        f"- State: v{report['state_version']['from']} → v{report['state_version']['to']}",
        f"- Name: {report['case_name']['legacy']} → {report['case_name']['matter']}"
        + ("（legacy name sources disagree）" if report["case_name"]["conflict"] else ""),
        f"- Registry: schema v{report['registry']['schema_version']}"
        f"，登记={'是' if report['registry']['registered'] else '否'}"
        f"，matters={report['registry']['matters_count']} / cases={report['registry']['cases_mirror_count']}",
        f"- Backup: `{report['backup']['directory']}`（snapshot_status={report['backup']['status']}）",
        "",
        "## 数据计数",
        "",
        "| 项 | 数量 |",
        "|---|---|",
    ]
    labels = {
        "facts": "facts",
        "issues": "issues",
        "pending_items": "pending items",
        "research_artifacts": "research artifacts",
        "analysis_artifacts": "analysis artifacts",
        "reviews": "reviews",
    }
    lines.extend(f"| {labels[key]} | {value} |" for key, value in report["counts"].items())
    lines.append("")
    lines.append("## 校验")
    lines.append("")
    lines.append(f"- validate: {report['validation'].get('status', 'n/a')}")
    for key, value in (report["validation"].get("checks") or {}).items():
        lines.append(f"- {key}: {value}")
    if report["warnings"]:
        lines.append("")
        lines.append("## Warnings")
        lines.append("")
        lines.extend(f"- {item}" for item in report["warnings"])
    return "\n".join(lines) + "\n"
