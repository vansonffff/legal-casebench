#!/usr/bin/env python3
"""State v4 Pending Item 状态写回：面板勾选完成/重开的唯一写入入口。

写入统一经 `state_update.mutate` → `commit`，因此同样受工作区锁、基线哈希
预检与 Matter ID preflight 保护。状态只接受规范值 `open` / `completed`；
存量中文自由值不回写、不改写。本脚本不创建、不删除任何 Pending Item。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from matter_io import MatterError, load_matter_state, now_timestamp
from state_update import mutate

ACTORS = ["workbuddy", "myagents", "codex", "dsh"]
# 只接受规范值：视图层对它们有确定的中文翻译与"已了结"判定；
# 中文自由值是存量数据的读侧兼容，不是写侧词汇。
STATUSES = ["open", "completed"]
# 与 casebench_view 的 PENDING_ID_KEYS 同序：展示编号（id）优先，其次规范 item_id。
ID_KEYS = ("id", "item_id")


def _load(case_dir: Path) -> tuple[Path, dict, Path]:
    """解析 Matter Root 并完成身份预检；旧案与未迁移状态在此 hard stop。"""

    root, _document, state = load_matter_state(case_dir)
    return root, state, root / "_case_state.json"


def _pending_of(state: dict) -> list:
    items = state.get("pending_items")
    if items is None:
        return []
    if not isinstance(items, list):
        raise MatterError("案件状态的 pending_items 必须是数组")
    return items


def _identifier(record: dict) -> str | None:
    for key in ID_KEYS:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _find(items: list, item_id: str) -> dict:
    matches = [item for item in items if isinstance(item, dict) and _identifier(item) == item_id]
    if len(matches) > 1:
        raise MatterError(f"Pending Item 编号不唯一：{item_id}；请先人工整理案件状态")
    if matches:
        return matches[0]
    known = [_identifier(item) for item in items if isinstance(item, dict) and _identifier(item)]
    raise MatterError(f"未找到 Pending Item：{item_id}；本案已知待办：{'、'.join(known) if known else '无'}")


def update_status(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir).expanduser()
    root, state, state_path = _load(case_dir)
    target = _find(_pending_of(state), args.item_id)
    stamp = now_timestamp()
    previous = target.get("status")
    if previous == args.status:
        print(json.dumps({"status": "unchanged", "item_id": args.item_id,
                          "pending_status": args.status, "matter_root": str(root)},
                         ensure_ascii=False))
        return

    def apply(data: dict) -> None:
        item = _find(_pending_of(data), args.item_id)
        item["status"] = args.status
        item["updated_at"] = stamp

    mutate(state_path, args.actor, f"pending-{args.item_id}-{args.status}", apply)
    print(json.dumps({"status": "updated", "item_id": args.item_id,
                      "previous_status": previous, "pending_status": args.status,
                      "matter_root": str(root)},
                     ensure_ascii=False))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    update = commands.add_parser("update-status", help="把 Pending Item 标记为 open/completed")
    update.add_argument("--case-dir", required=True)
    update.add_argument("--item-id", required=True, help="展示编号（如 P-001）或规范编号（TASK-0001）")
    update.add_argument("--status", required=True, choices=STATUSES)
    update.add_argument("--actor", required=True, choices=ACTORS)
    update.set_defaults(handler=update_status)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        args.handler(args)
        return 0
    except MatterError as exc:
        print(f"错误：{exc.code}: {exc}", file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, RuntimeError, KeyError) as exc:
        print(f"错误：MatterInvalid: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
