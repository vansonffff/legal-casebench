#!/usr/bin/env python3
"""兼容旧 Harness 的建案入口；新调用应使用 matter.py init。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from matter import _validate_name, initialize_matter
from matter_io import LegacyMatterNeedsMigration, MatterError, load_matter
from workspace_io import load_json


def _existing_entry(root: Path, name: str, case_path: Path) -> dict[str, Any]:
    registry = load_json(root / "_registry.json", {})
    if not isinstance(registry, dict):
        raise MatterError("既有登记表结构不兼容")
    candidates = []
    for key in ("matters", "cases"):
        items = registry.get(key, [])
        if isinstance(items, list):
            candidates.extend(item for item in items if isinstance(item, dict) and item.get("name") == name)

    matter_file = case_path / "matter.yaml"
    if matter_file.exists():
        document = load_matter(matter_file)
        if document["matter"]["name"] != name:
            raise MatterError(f"Matter 名称与目录不一致：{case_path}")
        matter_id = document["matter"]["id"]
        for item in candidates:
            if item.get("matter_id") == matter_id:
                return item
        return {
            "matter_id": matter_id,
            "name": name,
            "type": document["matter"]["type"],
            "product_dir": str(case_path),
            "status": document["matter"].get("status", "active"),
            "updated_at": document.get("metadata", {}).get("updated_at", ""),
        }

    if candidates:
        return candidates[0]
    raise LegacyMatterNeedsMigration(f"目录已存在但尚未登记或迁移为 Matter：{case_path}")


def register(
    root: Path,
    name: str,
    case_dir: str,
    drive: str,
    status: str | None,
    actor: str,
) -> dict[str, Any]:
    """保留旧 register() Python API；新目录通过 Matter init 创建。"""

    _validate_name(name)
    root = Path(root).expanduser().resolve()
    case_path = root / name
    if case_path.exists():
        return _existing_entry(root, name, case_path)
    result = initialize_matter(
        root,
        name,
        matter_type="unclassified",
        role="unknown",
        actor=actor,
        status=status or "open",
        case_dir=case_dir,
        drive=drive,
    )
    return result["registry_entry"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--case-dir", default="")
    parser.add_argument("--drive", default="")
    parser.add_argument("--status", choices=["open", "active", "paused", "closed"], default=None)
    parser.add_argument("--actor", required=True, choices=["workbuddy", "myagents", "codex", "dsh"])
    args = parser.parse_args()
    print(
        "Deprecated: register_case.py 将在未来版本废弃；推荐使用 matter.py init。",
        file=sys.stderr,
    )
    result = register(Path(args.root), args.name, args.case_dir, args.drive, args.status, args.actor)
    print(json.dumps({"status": "registered", "entry": result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except MatterError as exc:
        print(f"错误：{exc.code}: {exc}", file=sys.stderr)
        raise SystemExit(2)
