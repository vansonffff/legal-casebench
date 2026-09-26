#!/usr/bin/env python3
"""预览或升级旧案件状态到 schema v3；默认只读检查。

本脚本只服务 **Matter 之前** 的存量 state。任何 Matter 托管目录、或已声明
schema v4+ 的 state，都在这里 hard stop，不得按 legacy migration 处理，
更不得把 v4 降级为 v3。
"""

from __future__ import annotations

import argparse
import datetime
import json
import shutil
import sys
from pathlib import Path

try:
    from matter_io import MATTER_FILENAME, STATE_SCHEMA_VERSION
except ModuleNotFoundError:  # pragma: no cover - 仅支持从任意工作目录导入
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from matter_io import MATTER_FILENAME, STATE_SCHEMA_VERSION

from workspace_io import atomic_write, dump_json_bytes, file_digest, load_json, workspace_lock, writer_record


class StateGuardError(ValueError):
    """本脚本不得改写的状态：Matter 托管、损坏的 v4、或非 JSON 对象。"""


def migrated(data: dict) -> tuple[dict, dict]:
    result = dict(data)
    summary = {"facts_converted": 0, "issues_numbered": 0, "fields_added": []}
    additions = {
        "schema_version": 3,
        "case_tier": None,
        "research_artifacts": [],
        "analysis_artifacts": [],
        "last_writer": None,
        "handoff_history": [],
    }
    for key, value in additions.items():
        if key not in result:
            result[key] = value
            summary["fields_added"].append(key)
    if result.get("schema_version") != 3:
        result["schema_version"] = 3
    facts = []
    for item in result.get("facts", []):
        if not isinstance(item, dict) or item.get("fact_id"):
            facts.append(item)
            continue
        converted = {
            "fact_id": f"F-{len(facts) + 1:03d}",
            "text": item.get("fact", item.get("text", "")),
            "kind": "legacy_unclassified",
            "source_party": item.get("source_party"),
            "sources": [{
                "source_id": "legacy",
                "file": item.get("file"),
                "locator": item.get("anchor") or item.get("locator") or "",
            }],
            "verification": {"status": "pending"},
            "conflicts_with": [],
            "supersedes": [],
            "history": [],
        }
        facts.append(converted)
        summary["facts_converted"] += 1
    result["facts"] = facts
    issues = []
    for index, item in enumerate(result.get("issues", []), 1):
        if not isinstance(item, dict):
            issues.append(item)
            continue
        converted = dict(item)
        if not converted.get("id"):
            converted["id"] = f"I-{index:03d}"
            summary["issues_numbered"] += 1
        if "question" not in converted and "issue" in converted:
            converted["question"] = converted["issue"]
        issues.append(converted)
    result["issues"] = issues
    return result, summary


def assert_not_matter_managed(path: Path, state: dict) -> None:
    """Matter 托管目录与 v4+ state 一律 hard stop，绝不做 legacy 处理或降级。

    判定顺序（任一命中即拒绝）：
    1. 状态目录存在 matter.yaml —— 该目录是 Matter Root，其状态只能经
       matter.py / state_update.py 在身份预检下维护；
    2. schema_version >= v4 但缺 matter_id —— 视为损坏的 Matter 状态，禁止降级为 v3；
    3. 带 matter_id —— 已由 Matter Contract 托管，禁止降级为 v3。
    """

    version = state.get("schema_version")
    version_number = version if isinstance(version, int) and not isinstance(version, bool) else None
    managed = isinstance(state.get("matter_id"), str) and state["matter_id"].strip()

    if (path.parent / MATTER_FILENAME).exists():
        raise StateGuardError(
            f"{path.parent} 是 Matter Root（存在 {MATTER_FILENAME}）；本脚本只迁移 Matter 之前的存量 state，"
            "不得改写 Matter 托管案件的状态。请使用 matter.py / state_update.py 维护。"
        )
    if version_number is not None and version_number >= STATE_SCHEMA_VERSION:
        if managed:
            raise StateGuardError(
                f"该状态已由 Matter Contract 托管（schema_version={version_number}，"
                f"matter_id={state['matter_id']}），不得用本脚本降级到 schema v3；"
                "请使用 matter.py 系列命令维护。"
            )
        raise StateGuardError(
            f"状态声明 schema_version={version_number} 但缺少 matter_id，属损坏的 Matter Contract 状态；"
            "拒绝按 legacy migration 处理，也不会降级到 v3。请先恢复其 matter_id 或按 Matter 流程重建。"
        )
    if managed:
        raise StateGuardError(
            f"该状态带有 matter_id（{state['matter_id']}）但未声明 schema_version；"
            "无法确认其版本，拒绝按 legacy migration 处理。"
        )


def process(path: Path, apply: bool) -> dict:
    original = load_json(path)
    if not isinstance(original, dict):
        raise StateGuardError(f"状态文件不是 JSON 对象：{path}")
    assert_not_matter_managed(path, original)
    result, summary = migrated(original)
    summary.update({"path": str(path), "changed": result != original, "applied": False, "backup": None})
    if apply and summary["changed"]:
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(path.name + f".bak.{stamp}")
        with workspace_lock(path.parent):
            baseline = file_digest(path)
            shutil.copy2(path, backup)
            result["last_writer"] = writer_record("migration", "schema-v3")
            result["updated_at"] = datetime.date.today().isoformat()
            atomic_write(path, dump_json_bytes(result), baseline)
        summary["applied"] = True
        summary["backup"] = str(backup)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="只读预览（默认）")
    mode.add_argument("--apply", action="store_true", help="备份后写入")
    parser.add_argument("--root", help="扫描根目录下一层的 _case_state.json")
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    targets = [Path(item).resolve() for item in args.paths]
    if args.root:
        targets.extend(sorted(Path(args.root).resolve().glob("*/_case_state.json")))
    targets = list(dict.fromkeys(targets))
    if not targets:
        raise SystemExit("请提供 --root 或状态文件路径")
    try:
        summaries = [process(path, args.apply) for path in targets]
    except StateGuardError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(summaries, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

