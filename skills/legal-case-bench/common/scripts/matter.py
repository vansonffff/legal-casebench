#!/usr/bin/env python3
"""Legal Case Bench Matter CLI：init、validate、show、migrate。"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any

import matter_migration
import migration_transaction
import registry_io
from matter_io import (
    LegacyMatterNeedsMigration,
    MatterError,
    MatterInvalid,
    MatterRegistryConflict,
    MigrationNotNeeded,
    SUPPORTED_TYPES,
    generate_matter_id,
    load_matter,
    matter_path,
    resolve_matter_root,
    validate_matter,
    write_matter,
)
from workspace_io import (
    atomic_write,
    dump_json_bytes,
    file_digest,
    workspace_lock,
    writer_record,
)


MATTER_STATUS_DEFAULT = "active"
REGISTRY_FILENAME = registry_io.REGISTRY_FILENAME
INDEX_FILENAME = registry_io.INDEX_FILENAME


def _today() -> str:
    return datetime.date.today().isoformat()


def _timestamp() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def _validate_name(name: str) -> None:
    if not isinstance(name, str) or not name.strip() or name in {".", ".."}:
        raise MatterError("案件名必须是非空单层目录名")
    if any(char in name for char in "/\\|\n\r"):
        raise MatterError("案件名必须是单层目录名，不得含路径分隔符或表格分隔符")


def _validate_ref(value: str, label: str) -> None:
    if any(char in value for char in "|\n\r"):
        raise MatterError(f"{label}不得含换行或表格分隔符")


def _unique(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        if value not in result:
            result.append(value)
    return result


def _matter_document(
    *,
    matter_id: str,
    name: str,
    matter_type: str,
    role: str,
    code: str,
    subtypes: list[str] | None,
    status: str,
    case_tier: str | None,
    procedure_kind: str,
    procedure_stage: str,
    modules: list[str] | None,
    case_dir: str,
    drive: str,
    actor: str,
    country: str = "",
    province: str = "",
    city: str = "",
    court: str = "",
) -> dict[str, Any]:
    bindings: dict[str, dict[str, str]] = {}
    if case_dir:
        bindings["materials"] = {"provider": "local", "ref": case_dir}
    if drive:
        bindings["documents"] = {"provider": "kdocs", "ref": drive}
    return {
        "schema_version": 1,
        "matter": {
            "id": matter_id,
            "code": code or None,
            "name": name,
            "aliases": [],
            "type": matter_type,
            "subtypes": _unique(subtypes),
            "status": status,
        },
        # canonical skeleton 与 migration 保持一致：未知一律 null，不自动填 CN。
        # jurisdiction 属 Matter identity，不推断；只有调用方显式给出才写入。
        "jurisdiction": {
            "country": country or None,
            "province": province or None,
            "city": city or None,
            "court": court or None,
        },
        "engagement": {
            "role": role,
            "represented_party": None,
        },
        "procedure": {
            "kind": procedure_kind,
            "stage": procedure_stage,
        },
        "governance": {
            "case_tier": case_tier,
        },
        "modules": _unique(modules),
        "bindings": bindings,
        "metadata": {
            "created_at": _timestamp(),
            "updated_at": _timestamp(),
            "created_by": actor,
        },
    }


def _initial_state(name: str, matter_id: str, case_tier: str | None, actor: str) -> dict[str, Any]:
    return {
        "schema_version": 4,
        "matter_id": matter_id,
        "case_name": name,
        "case_tier": case_tier,
        "updated_at": _today(),
        "facts": [],
        "issues": [],
        "pending_items": [],
        "reviews": [],
        "research_artifacts": [],
        "analysis_artifacts": [],
        "last_writer": writer_record(actor, "matter-init"),
        "handoff_history": [],
    }


def _check_registry_collision(registry: dict[str, Any], name: str, case_path: Path) -> None:
    for item in registry.get("matters", []):
        if not isinstance(item, dict):
            raise MatterRegistryConflict("Registry v2 含非对象 Matter 条目")
        if item.get("name") == name or item.get("product_dir") == str(case_path):
            raise MatterRegistryConflict(f"Matter 已在 Registry 登记：{name}")
    for item in registry.get("cases", []):
        if isinstance(item, dict) and item.get("name") == name:
            raise LegacyMatterNeedsMigration(f"旧案已存在但尚未迁移：{name}")


def _restore_file(path: Path, before: bytes | None) -> None:
    if before is None:
        if path.exists() and not path.is_symlink():
            path.unlink()
        return
    atomic_write(path, before, file_digest(path))


def initialize_matter(
    root: Path,
    name: str,
    *,
    matter_type: str = "unclassified",
    role: str = "unknown",
    actor: str = "codex",
    code: str = "",
    subtypes: list[str] | None = None,
    status: str = MATTER_STATUS_DEFAULT,
    case_tier: str | None = None,
    procedure_kind: str = "unknown",
    procedure_stage: str = "unknown",
    modules: list[str] | None = None,
    case_dir: str = "",
    drive: str = "",
    country: str = "",
    province: str = "",
    city: str = "",
    court: str = "",
) -> dict[str, Any]:
    """创建一个新 Matter；不对已有案件执行猜测、迁移或覆盖。"""

    _validate_name(name)
    _validate_ref(case_dir, "材料路径")
    _validate_ref(drive, "云端标识")
    root = Path(root).expanduser().resolve()
    case_path = root / name
    if matter_type not in SUPPORTED_TYPES:
        raise MatterError(f"不支持的 Matter type：{matter_type}")
    if not role or not role.strip():
        raise MatterError("正式角色不能为空；未知时使用 unknown")
    if not status or not status.strip():
        raise MatterError("Matter status 不能为空")

    with workspace_lock(root):
        if case_path.exists():
            if (case_path / "matter.yaml").exists():
                raise MatterRegistryConflict(f"Matter 已存在：{case_path}")
            raise LegacyMatterNeedsMigration(f"目录已存在但尚未迁移为 Matter：{case_path}")

        registry_path = root / REGISTRY_FILENAME
        index_path = root / INDEX_FILENAME
        registry_before = registry_path.read_bytes() if registry_path.exists() else None
        index_before = index_path.read_bytes() if index_path.exists() else None
        registry = registry_io.upgrade_to_v2_shell(
            registry_io.load_registry(registry_path), root
        )
        _check_registry_collision(registry, name, case_path)

        matter_id = generate_matter_id()
        created_at = _timestamp()
        document = _matter_document(
            matter_id=matter_id,
            name=name,
            matter_type=matter_type,
            role=role,
            code=code,
            subtypes=subtypes,
            status=status,
            case_tier=case_tier,
            procedure_kind=procedure_kind,
            procedure_stage=procedure_stage,
            modules=modules,
            case_dir=case_dir,
            drive=drive,
            actor=actor,
            country=country,
            province=province,
            city=city,
            court=court,
        )
        state = _initial_state(name, matter_id, case_tier, actor)
        entry = registry_io.build_matter_entry(
            matter_id=matter_id,
            name=name,
            root=root,
            matter_type=matter_type,
            code=code,
            role=role,
            procedure_stage=procedure_stage,
            status=status,
            case_dir=case_dir,
            drive=drive,
        )
        registry_io.upsert_matter_entry(registry, entry, created_at)
        index_text = index_path.read_text(encoding="utf-8") if index_path.exists() else None
        index_content = registry_io.update_index(index_text, entry).encode("utf-8")

        stage_root = root / f".matter-init-{uuid.uuid4().hex}"
        stage_case = stage_root / name
        registry_written = False
        index_written = False
        case_created = False
        try:
            stage_case.mkdir(parents=True, exist_ok=False)
            write_matter(stage_case, document)
            note = (
                f"# {name}案件笔记\n\n"
                f"Matter ID: {matter_id}\n\n"
                f"[{_today()} · 建案] 建立共同案件工作区。\n"
            )
            atomic_write(stage_case / "00-案件笔记.md", note.encode("utf-8"), None)
            # init 是唯一的非 commit 写入路径：身份由本次生成，写前显式确认一对一关联。
            if state.get("matter_id") != document["matter"]["id"]:
                raise MatterInvalid("初始状态 matter_id 与 Matter Contract 不一致")
            atomic_write(stage_case / "_case_state.json", dump_json_bytes(state), None)
            (stage_case / "01-过程稿").mkdir()
            (stage_case / "02-定稿").mkdir()

            atomic_write(
                registry_path,
                dump_json_bytes(registry),
                file_digest(registry_path) if registry_path.exists() else None,
            )
            registry_written = True
            atomic_write(
                index_path,
                index_content,
                file_digest(index_path) if index_path.exists() else None,
            )
            index_written = True
            os.replace(stage_case, case_path)
            case_created = True
            stage_root.rmdir()
        except BaseException:
            if case_created and case_path.exists() and not case_path.is_symlink():
                shutil.rmtree(case_path)
            if index_written:
                _restore_file(index_path, index_before)
            if registry_written:
                _restore_file(registry_path, registry_before)
            if stage_root.exists() and not stage_root.is_symlink():
                shutil.rmtree(stage_root)
            raise

    return {
        "status": "created",
        "matter_id": matter_id,
        "matter_path": str(case_path / "matter.yaml"),
        "state_path": str(case_path / "_case_state.json"),
        "registry_path": str(registry_path),
        "index_path": str(index_path),
        "registry_entry": entry,
    }


def _resolve_target(path: str, workspace_root: str | None) -> Path:
    candidate = Path(path).expanduser()
    if candidate.name == "matter.yaml" or (candidate.exists() and candidate.is_file()):
        return matter_path(candidate)
    return resolve_matter_root(candidate, workspace_root=workspace_root) / "matter.yaml"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="创建新 Matter")
    init.add_argument("--root", required=True, help="共同案件工作区根目录")
    init.add_argument("--name", required=True, help="案件目录和显示名称")
    init.add_argument("--type", dest="matter_type", choices=sorted(SUPPORTED_TYPES), default="unclassified")
    init.add_argument("--role", default="unknown", help="律师团队正式事务角色")
    init.add_argument("--actor", choices=["workbuddy", "myagents", "codex", "dsh"], default="codex")
    init.add_argument("--code", default="")
    init.add_argument("--subtype", action="append", default=[])
    init.add_argument("--module", dest="modules", action="append", default=[])
    init.add_argument("--status", default=MATTER_STATUS_DEFAULT)
    init.add_argument("--case-tier", choices=["routine", "complex", "critical"], default=None)
    init.add_argument("--procedure-kind", default="unknown")
    init.add_argument("--procedure-stage", default="unknown")
    init.add_argument("--case-dir", default="", help="材料源位置，仅写入 bindings.ref")
    init.add_argument("--drive", default="", help="文档资源标识，仅写入 bindings.ref")
    # jurisdiction 属 Matter identity：默认全部 null，只有显式给出才写入，不自动填 CN。
    init.add_argument("--country", default="", help="显式管辖国家；不填保持 null")
    init.add_argument("--province", default="")
    init.add_argument("--city", default="")
    init.add_argument("--court", default="")

    for name in ("validate", "show"):
        command = commands.add_parser(name)
        command.add_argument("--path", default=".", help="Matter 目录、matter.yaml 或其子目录")
        command.add_argument("--workspace-root", default=None, help="Matter 向上解析的边界目录")

    migrate = commands.add_parser("migrate", help="把 legacy 案件迁移为 Matter（默认 dry-run）")
    migrate.add_argument("--case-dir", required=True, help="待迁移的案件目录")
    migrate.add_argument("--root", default=None, help="共同案件工作区根目录；默认取案件目录的上一级")
    migrate.add_argument("--dry-run", action="store_true", help="只预览，不写入（默认行为）")
    migrate.add_argument("--apply", action="store_true", help="正式写入；不带此参数为 dry-run，不写任何文件")
    migrate.add_argument("--actor", choices=["workbuddy", "myagents", "codex", "dsh"], default="codex")
    migrate.add_argument("--backup-dir", default=None, help="迁移快照目录（默认 <root>/.migration/）")
    migrate.add_argument("--json", action="store_true", help="以 JSON 输出计划")
    migrate.add_argument("--verbose", action="store_true", help="输出完整计划对象")
    migrate.add_argument(
        "--report",
        nargs="?",
        const="",
        default=None,
        help="迁移审计报告落点（§106）；不带值时写入 .migration/reports/。--apply 默认就会写",
    )
    return parser


def run_migration(args: argparse.Namespace) -> int:
    """inspect → plan → dry-run；`--apply` 走可恢复的多文件事务。"""

    inspection = matter_migration.inspect_case(args.case_dir, args.root)
    try:
        plan = matter_migration.build_plan(inspection, actor=args.actor)
    except MigrationNotNeeded as exc:
        payload = {
            "status": "not_needed",
            "kind": inspection["kind"],
            "matter_id": inspection["matter_id"],
            "case_dir": inspection["case_dir"],
            "message": str(exc),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2) if args.json else f"Migration not needed: {exc}")
        return 0

    if args.apply:
        return _apply_migration(plan, args)

    if args.json:
        payload = plan if args.verbose else {
            "status": "planned",
            "kind": plan["kind"],
            "mode": plan["mode"],
            "case_dir": plan["case_dir"],
            "matter_name": plan["legacy_case_name"],
            "proposed_matter_id": plan["proposed_matter_id"],
            "state": {"from": plan["source_state_version"], "to": plan["target_state_version"]},
            "state_changes": plan["state_changes"],
            "registry_changes": plan["registry_changes"],
            "index_changes": plan["index_changes"],
            "preserved": plan["preserved"],
            "not_touched": plan["not_touched"],
            "backup_files": plan["backup_files"],
            "snapshot": plan["snapshot"],
            "warnings": plan["warnings"],
            "errors": plan["errors"],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print(matter_migration.render_plan(plan))
    if args.verbose:
        print()
        print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 0


def _report_path(plan: dict[str, Any], requested: str | None) -> Path:
    """报告落点：显式给出则用它，否则写进 <root>/.migration/reports/。"""

    if requested:
        return Path(requested).expanduser()
    stamp = datetime.date.today().isoformat()
    case_dir = Path(plan["case_dir"])
    return (
        Path(plan["product_root"])
        / ".migration"
        / "reports"
        / f"matter-migration-report-{case_dir.name}-{stamp}.md"
    )


def _validation_summary(case_dir: Path) -> dict[str, Any]:
    """迁移后的校验摘要，进报告用（§106）。"""

    try:
        warnings = validate_matter(case_dir)
    except MatterError as exc:
        return {"status": "failed", "code": exc.code, "message": str(exc)}
    document = load_matter(case_dir)
    return {
        "status": "valid",
        "matter_id": document["matter"]["id"],
        "warnings": warnings,
        "checks": {
            "matter_document": "ok",
            "state_schema": "v4",
            "identity_consistent": "ok",
        },
    }


def _apply_migration(plan: dict[str, Any], args: argparse.Namespace) -> int:
    """执行迁移事务并输出结果（§51 / §52）。"""

    result = migration_transaction.apply_plan(
        plan,
        actor=args.actor,
        backup_parent=args.backup_dir,
    )

    # §106：每次正式迁移都留一份审计报告。默认落在 .migration/reports/——
    # 它属于系统迁移 metadata，不是律师工作成果，因此不进 02-定稿。
    validation = _validation_summary(Path(plan["case_dir"]))
    report = migration_transaction.build_migration_report(plan, result, validation=validation)
    target = _report_path(plan, args.report)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.suffix.lower() == ".md":
            target.write_text(migration_transaction.render_migration_report(report), encoding="utf-8")
        else:
            target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        result["report"] = str(target)
    except OSError as exc:
        # 报告写失败不影响已经完成的迁移，但必须说出来。
        print(f"警告：迁移已完成，但审计报告写入失败：{target}: {exc}", file=sys.stderr)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    lines = [
        "Migration completed" + ("（resumed）" if result["resumed"] else ""),
        "",
        f"Matter ID:   {result['matter_id']}",
        f"Case:        {result['case_dir']}",
        f"Mode:        {result['mode']}",
        f"Steps:       {' → '.join(result['steps'])}",
        "",
        "Backup:",
        f"  {result['snapshot']['directory']}",
        "  manifest.json 记录每个文件的 original_path 与 sha256（可用于人工校验与恢复）",
    ]
    if result["warnings"]:
        lines.append("")
        lines.append("Warnings:")
        lines.extend(f"  - {item}" for item in result["warnings"])
    if result.get("report"):
        lines.append("")
        lines.append(f"Migration report: {result['report']}")
    lines.append("")
    lines.append("下一步建议：matter.py validate --path <案件目录>")
    print("\n".join(lines))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "migrate":
        # migrate 自带 JSON / 错误输出约定，单独走一条路径。
        try:
            return run_migration(args)
        except MatterError as exc:
            if getattr(args, "json", False):
                print(
                    json.dumps(
                        {"status": "blocked", "code": exc.code, "message": str(exc)},
                        ensure_ascii=False,
                        indent=2,
                    )
                )
            else:
                print(f"错误：{exc.code}: {exc}", file=sys.stderr)
            return 2
        except (OSError, ValueError, TypeError) as exc:
            print(f"错误：MigrationSourceInvalid: {exc}", file=sys.stderr)
            return 2
    try:
        if args.command == "init":
            result = initialize_matter(
                Path(args.root),
                args.name,
                matter_type=args.matter_type,
                role=args.role,
                actor=args.actor,
                code=args.code,
                subtypes=args.subtype,
                status=args.status,
                case_tier=args.case_tier,
                procedure_kind=args.procedure_kind,
                procedure_stage=args.procedure_stage,
                modules=args.modules,
                case_dir=args.case_dir,
                drive=args.drive,
                country=args.country,
                province=args.province,
                city=args.city,
                court=args.court,
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        target = _resolve_target(args.path, args.workspace_root)
        if args.command == "validate":
            warnings = validate_matter(target)
            document = load_matter(target)
            result = {
                "status": "valid",
                "matter_path": str(target),
                "matter_id": document["matter"]["id"],
                "warnings": warnings,
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            # show 也是 Matter 入口：发现已有 state.matter_id 冲突时不能只展示错误身份。
            validate_matter(target)
            print(json.dumps(load_matter(target), ensure_ascii=False, indent=2))
        return 0
    except MatterError as exc:
        print(f"错误：{exc.code}: {exc}", file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError) as exc:
        print(f"错误：MatterInvalid: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
