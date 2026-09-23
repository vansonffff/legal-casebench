#!/usr/bin/env python3
"""以共享锁和基线哈希读取、提交案件状态。"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any, Callable

from matter_io import MATTER_FILENAME, assert_matter_state_match, load_matter
from workspace_io import atomic_write, dump_json_bytes, file_digest, load_json, workspace_lock, writer_record


def matter_identity_precheck(path: Path, data: dict) -> list[str]:
    """写入前确认 State 与 Matter 身份一致；身份无法确认就不落盘。

    没有 matter.yaml 的存量旧案不受影响：v3 仍可读写，可用 matter.py migrate 升级。
    matter.yaml 存在但本身无效时同样停止；返回兼容性提示供调用方展示。
    校验实现集中在 matter_io，写入入口不得各自重写身份比较。
    """

    matter_file = path.parent / MATTER_FILENAME
    if not matter_file.exists():
        return []
    document = load_matter(matter_file)
    return assert_matter_state_match(path.parent, data, document, strict=True)


def snapshot(path: Path) -> dict:
    return {"sha256": file_digest(path), "data": load_json(path, {})}


def commit(path: Path, expected: str, data: dict, actor: str, operation_id: str = "") -> None:
    if not isinstance(data, dict):
        raise ValueError("案件状态必须是 JSON 对象")
    with workspace_lock(path.parent):
        if file_digest(path) != expected:
            raise RuntimeError("案件状态已变化；请重新 snapshot 并合并，禁止强制覆盖")
        matter_identity_precheck(path, data)
        old = load_json(path, {})
        missing = set(old) - set(data)
        if missing:
            raise ValueError("新状态遗漏既有顶层字段：" + ", ".join(sorted(missing)))
        data = dict(data)
        data.setdefault("schema_version", 3)
        data.setdefault("case_tier", None)
        data.setdefault("research_artifacts", [])
        data.setdefault("analysis_artifacts", [])
        data.setdefault("handoff_history", [])
        data["last_writer"] = writer_record(actor, operation_id)
        atomic_write(path, dump_json_bytes(data), expected)


def mutate(
    path: Path,
    actor: str,
    operation_id: str,
    apply: Callable[[dict], Any],
) -> dict:
    """统一 mutation 入口：snapshot → 只改目标字段 → commit。

    `apply` 收到磁盘状态的深拷贝，只需修改目标字段；其余已知字段与未知字段
    原样保留，不允许重建白名单对象后覆盖整个 state。
    """

    snap = snapshot(path)
    data = copy.deepcopy(snap["data"])
    if not isinstance(data, dict):
        raise ValueError("案件状态必须是 JSON 对象")
    apply(data)
    commit(path, snap["sha256"], data, actor, operation_id)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    read = actions.add_parser("snapshot")
    read.add_argument("--path", required=True)
    write = actions.add_parser("commit")
    write.add_argument("--path", required=True)
    write.add_argument("--expected", required=True)
    write.add_argument("--input", required=True)
    write.add_argument("--actor", required=True, choices=["workbuddy", "myagents", "codex", "dsh", "migration", "unknown"])
    write.add_argument("--operation-id", default="")
    args = parser.parse_args()
    path = Path(args.path)
    if args.action == "snapshot":
        print(json.dumps(snapshot(path), ensure_ascii=False, indent=2))
        return
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    commit(path, args.expected, payload, args.actor, args.operation_id)
    print("案件状态已保存")


if __name__ == "__main__":
    main()
