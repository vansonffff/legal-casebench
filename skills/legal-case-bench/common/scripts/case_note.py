#!/usr/bin/env python3
"""为普通案件问答、用户指示和策略决定追加紧凑、可去重的案件笔记。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
from pathlib import Path

from workspace_io import atomic_write, file_digest, workspace_lock

CATEGORY_LABELS = {
    "qa": "问答沉淀",
    "user_instruction": "用户指示",
    "strategy": "策略决定",
    "fact_lead": "事实线索",
    "todo": "待办变更",
    "document": "文稿",
    "review": "复核",
    "final": "定稿",
    "series_summary": "系列摘要",
}


def compact(value: str | None) -> str:
    return " ".join((value or "").split())


def relative_artifact(case_dir: Path, artifact: str | None) -> str | None:
    if not artifact:
        return None
    raw = Path(artifact)
    target = raw.resolve() if raw.is_absolute() else (case_dir / raw).resolve()
    if target != case_dir and case_dir not in target.parents:
        raise ValueError(f"关联成果必须位于案件目录内：{target}")
    if not target.exists():
        raise ValueError(f"关联成果不存在：{target}")
    return str(target.relative_to(case_dir))


def note_id(day: str, category: str, question: str, conclusion: str, artifact: str | None) -> str:
    payload = json.dumps(
        [day, category, compact(question).lower(), compact(conclusion).lower(), artifact or ""],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def append_entry(
    case_dir: Path,
    *,
    category: str,
    question: str,
    conclusion: str,
    premise: str = "",
    risk: str = "",
    next_step: str = "",
    artifact: str | None = None,
    harness: str,
    now: datetime.datetime | None = None,
) -> dict:
    case_dir = case_dir.resolve()
    note_path = case_dir / "00-案件笔记.md"
    if not note_path.is_file():
        raise ValueError(f"未找到案件笔记，不能猜测案件目录：{note_path}")
    if category not in CATEGORY_LABELS:
        raise ValueError(f"未知笔记类型：{category}")
    conclusion = compact(conclusion)
    if not conclusion:
        raise ValueError("结论或记录内容不能为空")
    question = compact(question)
    premise = compact(premise)
    risk = compact(risk)
    next_step = compact(next_step)
    artifact_path = relative_artifact(case_dir, artifact)
    moment = now or datetime.datetime.now().astimezone()
    day = moment.date().isoformat()
    marker_id = note_id(day, category, question, conclusion, artifact_path)
    marker = f"<!-- case-note-id:{marker_id} -->"

    conclusion_label = {
        "user_instruction": "用户指示",
        "fact_lead": "线索（未核）",
        "todo": "变更",
    }.get(category, "结论")
    lines = [f"[{moment.strftime('%Y-%m-%d %H:%M')} · {CATEGORY_LABELS[category]} · {harness}]", marker]
    if question:
        lines.append(f"- 问题：{question}")
    lines.append(f"- {conclusion_label}：{conclusion}")
    if premise:
        lines.append(f"- 前提：{premise}")
    if risk:
        lines.append(f"- 风险/待核：{risk}")
    if next_step:
        lines.append(f"- 后续：{next_step}")
    if artifact_path:
        lines.append(f"- 关联成果：{artifact_path}")
    entry = "\n".join(lines) + "\n"

    with workspace_lock(case_dir):
        before = note_path.read_text(encoding="utf-8")
        if marker in before:
            return {"status": "duplicate", "note": str(note_path), "note_id": marker_id}
        if before and not before.endswith("\n"):
            before += "\n"
        atomic_write(note_path, (before + "\n" + entry).encode("utf-8"), file_digest(note_path))
    return {"status": "appended", "note": str(note_path), "note_id": marker_id}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    append = commands.add_parser("append")
    append.add_argument("--case-dir", required=True)
    append.add_argument("--category", required=True, choices=[key for key in CATEGORY_LABELS if key != "series_summary"])
    append.add_argument("--question", default="")
    append.add_argument("--conclusion", required=True)
    append.add_argument("--premise", default="")
    append.add_argument("--risk", default="")
    append.add_argument("--next-step", default="")
    append.add_argument("--artifact")
    append.add_argument("--harness", required=True, choices=["workbuddy", "myagents", "codex", "dsh"])
    append.add_argument("--series-root")
    append.add_argument("--series-summary")
    args = parser.parse_args()

    if bool(args.series_root) != bool(args.series_summary):
        raise SystemExit("--series-root 与 --series-summary 必须同时提供")
    case_dir = Path(args.case_dir).resolve()
    series_root = Path(args.series_root).resolve() if args.series_root else None
    if series_root and (series_root == case_dir or series_root not in case_dir.parents):
        raise SystemExit("系列总夹必须是子案目录的上级目录")
    result = append_entry(
        case_dir,
        category=args.category,
        question=args.question,
        conclusion=args.conclusion,
        premise=args.premise,
        risk=args.risk,
        next_step=args.next_step,
        artifact=args.artifact,
        harness=args.harness,
    )
    response = {"case": result}
    if series_root:
        response["series"] = append_entry(
            series_root,
            category="series_summary",
            question=args.question,
            conclusion=args.series_summary,
            artifact=str(case_dir / "00-案件笔记.md"),
            harness=args.harness,
        )
    print(json.dumps(response, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
