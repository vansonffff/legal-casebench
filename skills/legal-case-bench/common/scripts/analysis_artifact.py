#!/usr/bin/env python3
"""建立并登记不改写案件事实的专项分析成果。"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path

from state_update import commit, snapshot
from workspace_io import (
    append_note,
    atomic_write,
    dump_json_bytes,
    file_digest,
    load_json,
    sha256_file,
    workspace_lock,
)

ROOT_DEFAULT = str(Path.home() / "Documents" / "My Legal-agents")


def next_task(case_dir: Path) -> tuple[Path, str]:
    process = case_dir / "01-过程稿"
    process.mkdir(parents=True, exist_ok=True)
    used = set()
    for child in process.iterdir():
        if child.is_dir() and child.name.startswith("疑难分析-"):
            try:
                used.add(int(child.name.rsplit("-", 1)[1]))
            except ValueError:
                continue
    sequence = 1
    while sequence in used:
        sequence += 1
    return process / f"疑难分析-{sequence:03d}", f"ANA-{datetime.date.today().strftime('%Y%m%d')}-{sequence:03d}"


def artifact_index(state: dict) -> dict[str, dict]:
    result = {}
    for kind, key in (("research", "research_artifacts"), ("analysis", "analysis_artifacts")):
        for item in state.get(key, []):
            if isinstance(item, dict) and item.get("artifact_id"):
                result[item["artifact_id"]] = {**item, "artifact_kind": kind}
    return result


def resolve_inputs(state: dict, artifact_ids: list[str]) -> list[dict]:
    indexed = artifact_index(state)
    resolved = []
    for artifact_id in artifact_ids:
        item = indexed.get(artifact_id)
        if not item:
            raise ValueError(f"输入成果未登记：{artifact_id}")
        if not item.get("sha256"):
            raise ValueError(f"输入成果缺少哈希：{artifact_id}")
        resolved.append({
            "artifact_id": artifact_id,
            "artifact_kind": item["artifact_kind"],
            "sha256": item["sha256"],
        })
    return resolved


def stale_report(state: dict) -> list[dict]:
    indexed = artifact_index(state)
    reports = []
    for analysis in state.get("analysis_artifacts", []):
        if not isinstance(analysis, dict):
            continue
        reasons = []
        for recorded in analysis.get("input_artifacts", []):
            if not isinstance(recorded, dict) or not recorded.get("artifact_id") or not recorded.get("sha256"):
                reasons.append({"reason": "legacy_input_without_hash", "input": recorded})
                continue
            current = indexed.get(recorded["artifact_id"])
            if not current:
                reasons.append({"reason": "input_missing", "artifact_id": recorded["artifact_id"]})
            elif current.get("sha256") != recorded["sha256"]:
                reasons.append({
                    "reason": "input_hash_changed",
                    "artifact_id": recorded["artifact_id"],
                    "recorded_sha256": recorded["sha256"],
                    "current_sha256": current.get("sha256"),
                })
        reports.append({
            "artifact_id": analysis.get("artifact_id"),
            "stale": bool(reasons),
            "reasons": reasons,
        })
    return reports


def init_task(args: argparse.Namespace) -> None:
    case_dir = Path(args.root).resolve() / args.case
    if not (case_dir / "_case_state.json").exists():
        raise SystemExit(f"案件尚未登记：{case_dir}")
    with workspace_lock(case_dir):
        task, artifact_id = next_task(case_dir)
        (task / "20-过程稿").mkdir(parents=True, exist_ok=True)
        created = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        input_ids = [item.strip() for item in args.input_artifacts.split(",") if item.strip()]
        inputs = resolve_inputs(load_json(case_dir / "_case_state.json", {}), input_ids)
        manifest = {
            "artifact_id": artifact_id,
            "title": args.title,
            "input_artifacts": inputs,
            "path": "20-过程稿/专项分析.md",
            "created_at": created,
            "harness": args.harness,
            "status": "draft",
            "sha256": None,
        }
        instruction = (
            f"# 执行说明\n\n- 分析编号：{artifact_id}\n- 题目：{args.title}\n"
            f"- 输入成果：{', '.join(input_ids) or '见案件状态与笔记'}\n- 执行端：{args.harness}\n\n"
            "本任务只形成专项分析，不直接改写既有案件事实或已决口径。\n"
        )
        report = (
            f"# {args.title}\n\n## 结论\n\n待完成。\n\n## 依据与输入\n\n"
            "待列明。\n\n## 待核事实与检索缺口\n\n待列明。\n\n## 建议变更\n\n待列明。\n"
        )
        atomic_write(task / "00-执行说明.md", instruction.encode("utf-8"), file_digest(task / "00-执行说明.md"))
        atomic_write(task / "analysis-manifest.json", dump_json_bytes(manifest), file_digest(task / "analysis-manifest.json"))
        atomic_write(task / manifest["path"], report.encode("utf-8"), file_digest(task / manifest["path"]))
    print(json.dumps({"artifact_id": artifact_id, "task_dir": str(task)}, ensure_ascii=False))


def finalize_task(args: argparse.Namespace) -> None:
    task = Path(args.task).resolve()
    if task.parent.name != "01-过程稿":
        raise SystemExit("专项分析目录必须位于案件 01-过程稿 下")
    case_dir = task.parent.parent
    manifest_path = task / "analysis-manifest.json"
    manifest = load_json(manifest_path)
    if not manifest:
        raise SystemExit("未找到 analysis-manifest.json")
    report = task / manifest["path"]
    if not report.exists():
        raise SystemExit(f"缺少专项分析：{report}")
    manifest["status"] = args.status
    manifest["completed_at"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    manifest["sha256"] = sha256_file(report)
    atomic_write(manifest_path, dump_json_bytes(manifest), file_digest(manifest_path))

    state_path = case_dir / "_case_state.json"
    snap = snapshot(state_path)
    state = dict(snap["data"])
    state.setdefault("analysis_artifacts", [])
    pointer = {
        "artifact_id": manifest["artifact_id"],
        "title": manifest["title"],
        "input_artifacts": manifest.get("input_artifacts", []),
        "path": str(report.relative_to(case_dir)),
        "created_at": manifest["created_at"],
        "harness": manifest["harness"],
        "sha256": manifest["sha256"],
        "status": manifest["status"],
    }
    state["analysis_artifacts"] = [
        item for item in state["analysis_artifacts"] if item.get("artifact_id") != pointer["artifact_id"]
    ] + [pointer]
    state["updated_at"] = datetime.date.today().isoformat()
    commit(state_path, snap["sha256"], state, args.actor, manifest["artifact_id"])
    append_note(
        case_dir,
        f"[{datetime.date.today().isoformat()} · 专项分析] {manifest['title']}\n"
        f"  状态：{manifest['status']}；成果：{pointer['path']}",
    )
    print(json.dumps(pointer, ensure_ascii=False))


def check_stale(args: argparse.Namespace) -> None:
    case_dir = Path(args.case_dir).resolve()
    state = load_json(case_dir / "_case_state.json")
    if not isinstance(state, dict):
        raise SystemExit(f"未找到案件状态：{case_dir}")
    print(json.dumps(stale_report(state), ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    create = commands.add_parser("init")
    create.add_argument("--root", default=ROOT_DEFAULT)
    create.add_argument("--case", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--input-artifacts", default="")
    create.add_argument("--harness", required=True, choices=["workbuddy", "myagents", "codex", "dsh"])
    done = commands.add_parser("finalize")
    done.add_argument("--task", required=True)
    done.add_argument("--status", default="completed", choices=["draft", "completed", "superseded"])
    done.add_argument("--actor", required=True, choices=["workbuddy", "myagents", "codex", "dsh"])
    stale = commands.add_parser("check-stale")
    stale.add_argument("--case-dir", required=True)
    args = parser.parse_args()
    if args.action == "init":
        init_task(args)
    elif args.action == "finalize":
        finalize_task(args)
    else:
        check_stale(args)


if __name__ == "__main__":
    main()
