#!/usr/bin/env python3
"""State v4 Issue 关系中心：分配稳定 Issue ID，维护 fact/research/analysis 引用。

写入统一经 `state_update.mutate` → `commit`，因此同样受 Matter ID preflight 保护。
本脚本不创建、不修改任何 Artifact（Artifact Matter-awareness 排在 3.3 / 3.4）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from matter_io import (
    ISSUE_ID_PATTERN,
    MatterError,
    load_matter_state,
    new_issue,
    next_issue_id,
    now_timestamp,
    record_sequence,
    recorded_sequence,
    ref_target_field,
)
from state_update import mutate

REF_FIELDS = ("fact_refs", "research_refs", "analysis_refs")
SEQUENCE_KEY = "issue"
ACTORS = ["workbuddy", "myagents", "codex", "dsh"]


def _load(case_dir: Path) -> tuple[Path, dict, Path]:
    """解析 Matter Root 并完成身份预检；旧案与未迁移状态在此 hard stop。

    strict 预检保证返回的 state 必为 v4 且 matter_id 与 matter.yaml 一致。
    """

    root, _document, state = load_matter_state(case_dir)
    return root, state, root / "_case_state.json"


def _issues_of(state: dict) -> list:
    issues = state.get("issues")
    if issues is None:
        return []
    if not isinstance(issues, list):
        raise MatterError("案件状态的 issues 必须是数组")
    return issues


def _find(issues: list, issue_id: str) -> dict:
    for issue in issues:
        if isinstance(issue, dict) and issue.get("issue_id") == issue_id:
            return issue
    raise MatterError(f"未找到 Issue：{issue_id}")


def _require_issue_id(issue_id: str) -> None:
    if not ISSUE_ID_PATTERN.fullmatch(issue_id or ""):
        raise MatterError(f"非法 Issue ID：{issue_id}；格式为 ISS-0001")


def add_issue(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir).expanduser()
    root, state, state_path = _load(case_dir)
    issues = _issues_of(state)
    if args.issue_id:
        _require_issue_id(args.issue_id)
        if any(isinstance(item, dict) and item.get("issue_id") == args.issue_id for item in issues):
            raise MatterError(f"Issue ID 已存在，不得覆盖：{args.issue_id}")
    allocated = args.issue_id or next_issue_id(issues, recorded_sequence(state, SEQUENCE_KEY))
    record = new_issue(
        allocated,
        args.title,
        category=args.category or "",
        status=args.status,
        actor=args.actor,
    )

    def apply(data: dict) -> None:
        if not isinstance(data.get("issues"), list):
            data["issues"] = []
        data["issues"].append(record)
        record_sequence(data, SEQUENCE_KEY, allocated)

    mutate(state_path, args.actor, allocated, apply)
    print(
        json.dumps(
            {"status": "created", "issue_id": allocated, "matter_root": str(root)},
            ensure_ascii=False,
        )
    )


def rename_issue(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir).expanduser()
    root, state, state_path = _load(case_dir)
    _require_issue_id(args.issue_id)
    _find(_issues_of(state), args.issue_id)
    if args.title.strip() == args.issue_id:
        raise MatterError("Issue title 不得与 issue_id 相同")
    stamp = now_timestamp()

    def apply(data: dict) -> None:
        issue = _find(_issues_of(data), args.issue_id)
        issue["title"] = args.title.strip()
        issue["updated_at"] = stamp

    mutate(state_path, args.actor, f"rename-{args.issue_id}", apply)
    print(
        json.dumps(
            {"status": "renamed", "issue_id": args.issue_id, "matter_root": str(root)},
            ensure_ascii=False,
        )
    )


def link_issue(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir).expanduser()
    root, state, state_path = _load(case_dir)
    _require_issue_id(args.issue_id)
    _find(_issues_of(state), args.issue_id)
    routed: dict[str, list[str]] = {field: [] for field in REF_FIELDS}
    for ref in args.ref:
        # 前缀决定归属：检索成果与专项分析永远不会被写成 facts。
        routed[ref_target_field(ref)].append(ref)

    def apply(data: dict) -> None:
        issue = _find(_issues_of(data), args.issue_id)
        for field, refs in routed.items():
            bucket = issue.setdefault(field, [])
            if not isinstance(bucket, list):
                raise MatterError(f"{args.issue_id}.{field} 必须是数组")
            for ref in refs:
                if ref not in bucket:
                    bucket.append(ref)

    mutate(state_path, args.actor, f"link-{args.issue_id}", apply)
    print(
        json.dumps(
            {
                "status": "linked",
                "issue_id": args.issue_id,
                "refs": {field: refs for field, refs in routed.items() if refs},
                "matter_root": str(root),
            },
            ensure_ascii=False,
        )
    )


def list_issues(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir).expanduser()
    root, state, _state_path = _load(case_dir)
    payload = [
        {
            "issue_id": item.get("issue_id"),
            "title": item.get("title"),
            "status": item.get("status"),
            "fact_refs": len(item.get("fact_refs") or []),
            "research_refs": len(item.get("research_refs") or []),
            "analysis_refs": len(item.get("analysis_refs") or []),
        }
        for item in _issues_of(state)
        if isinstance(item, dict)
    ]
    print(
        json.dumps(
            {"matter_root": str(root), "count": len(payload), "issues": payload},
            ensure_ascii=False,
            indent=2,
        )
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("add", help="创建 Issue 并分配稳定 ISS 编号")
    create.add_argument("--case-dir", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--category", default="")
    create.add_argument("--status", default="active")
    create.add_argument("--issue-id", default="", help="仅用于显式补齐编号；已存在则拒绝")
    create.add_argument("--actor", required=True, choices=ACTORS)
    create.set_defaults(handler=add_issue)

    rename = commands.add_parser("rename", help="修改 Issue 标题（issue_id 不变）")
    rename.add_argument("--case-dir", required=True)
    rename.add_argument("--issue-id", required=True)
    rename.add_argument("--title", required=True)
    rename.add_argument("--actor", required=True, choices=ACTORS)
    rename.set_defaults(handler=rename_issue)

    link = commands.add_parser("link", help="按引用前缀登记 fact/research/analysis 引用")
    link.add_argument("--case-dir", required=True)
    link.add_argument("--issue-id", required=True)
    link.add_argument("--ref", action="append", required=True, help="可重复；FACT-/RA-/AA- 前缀")
    link.add_argument("--actor", required=True, choices=ACTORS)
    link.set_defaults(handler=link_issue)

    listing = commands.add_parser("list", help="列出 Issue 与引用数量")
    listing.add_argument("--case-dir", required=True)
    listing.set_defaults(handler=list_issues)
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
