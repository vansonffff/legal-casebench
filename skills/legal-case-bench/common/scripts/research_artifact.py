#!/usr/bin/env python3
"""建立、清理并登记案件检索成果包。"""

from __future__ import annotations

import argparse
import datetime
import json
from pathlib import Path

from state_update import commit, snapshot
from workspace_io import (
    append_note,
    assert_redacted_tree,
    atomic_write,
    dump_json_bytes,
    file_digest,
    load_json,
    sanitize,
    sha256_file,
    workspace_lock,
)

ROOT_DEFAULT = str(Path.home() / "Documents" / "My Legal-agents")
TYPE_NAMES = {"law": "法律检索", "case": "类案检索", "mixed": "综合检索"}
PAID_DB_SUMMARY_LIMIT = 2000


def add_source_metadata_args(parser: argparse.ArgumentParser) -> None:
    """为来源登记命令增加可脱敏的来源元数据字段。"""
    parser.add_argument("--status", default="")
    parser.add_argument("--provider", default="")
    parser.add_argument("--database-name", default="")
    parser.add_argument("--page-title", default="")
    parser.add_argument("--url", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--summary", default="")
    parser.add_argument("--retrieved-at", default="")


def _short_summary(value: object) -> object:
    if not isinstance(value, str):
        return value
    if len(value) <= PAID_DB_SUMMARY_LIMIT:
        return value
    return value[:PAID_DB_SUMMARY_LIMIT] + "…"


def paid_db_metadata(payload: object, args: argparse.Namespace) -> dict[str, object]:
    """只保留付费库的脱敏元数据和短摘要，不落盘整页响应。"""
    if not isinstance(payload, dict):
        raise SystemExit("paid-db 原始输入必须是 JSON 对象；默认只登记元数据和短摘要")
    cleaned = sanitize(payload)
    aliases = {
        "provider": ("provider",),
        "database_name": ("database_name",),
        "page_title": ("page_title", "title"),
        "url": ("url",),
        "query": ("query",),
        "summary": ("summary", "short_summary"),
        "retrieved_at": ("retrieved_at", "retrieval_date", "date"),
        "status": ("status",),
        "verification_status": ("verification_status",),
    }
    result: dict[str, object] = {"source": "paid-db"}
    for target, names in aliases.items():
        for name in names:
            if name in cleaned:
                value = cleaned[name]
                result[target] = _short_summary(value) if target == "summary" else value
                break
    overrides = {
        "provider": args.provider,
        "database_name": args.database_name,
        "page_title": args.page_title,
        "url": args.url,
        "query": args.query,
        "summary": args.summary,
        "retrieved_at": args.retrieved_at,
        "status": args.status,
    }
    for key, value in overrides.items():
        if value:
            result[key] = _short_summary(value) if key == "summary" else value
    result.setdefault("status", "used")
    result.setdefault("retrieved_at", datetime.datetime.now().astimezone().isoformat(timespec="seconds"))
    return result


def source_metadata(source: str, payload: object, args: argparse.Namespace) -> dict[str, object]:
    if source == "paid-db":
        return paid_db_metadata(payload, args)
    metadata: dict[str, object] = {"source": source, "status": args.status or "used"}
    if args.retrieved_at:
        metadata["retrieved_at"] = args.retrieved_at
    if args.provider:
        metadata["provider"] = args.provider
    return metadata


def update_source_metadata(task: Path, metadata: dict[str, object]) -> None:
    manifest_path = task / "research-manifest.json"
    with workspace_lock(task):
        manifest = load_json(manifest_path)
        if not manifest:
            raise SystemExit("未找到 research-manifest.json")
        entries = manifest.setdefault("sources_used", [])
        source = metadata["source"]
        entry = next((item for item in entries if item.get("source") == source), None)
        if entry is None:
            entry = {"source": source}
            entries.append(entry)
        entry.update(metadata)
        atomic_write(manifest_path, dump_json_bytes(manifest), file_digest(manifest_path))


def next_task(case_dir: Path, research_type: str) -> tuple[Path, str]:
    process = case_dir / "01-过程稿"
    process.mkdir(parents=True, exist_ok=True)
    prefix = TYPE_NAMES[research_type]
    used = set()
    for child in process.iterdir():
        if child.is_dir() and child.name.startswith(prefix + "-"):
            try:
                used.add(int(child.name.rsplit("-", 1)[1]))
            except ValueError:
                continue
    sequence = 1
    while sequence in used:
        sequence += 1
    task = process / f"{prefix}-{sequence:03d}"
    research_id = f"RES-{research_type.upper()}-{datetime.date.today().strftime('%Y%m%d')}-{sequence:03d}"
    return task, research_id


def init_task(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    case_dir = root / args.case
    if not case_dir.is_dir() or not (case_dir / "_case_state.json").exists():
        raise SystemExit(f"案件尚未登记：{case_dir}")
    with workspace_lock(case_dir):
        task, research_id = next_task(case_dir, args.type)
        for folder in [
            "10-中间转换/raw/ima",
            "10-中间转换/raw/yuandian",
            "10-中间转换/raw/official-web",
            "10-中间转换/raw/paid-db",
            "20-过程稿",
            "30-复核",
        ]:
            (task / folder).mkdir(parents=True, exist_ok=True)
        created = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        paths = {
            "report": "20-过程稿/检索报告.md",
            "law_results": "20-过程稿/law-results.json",
            "case_results": "20-过程稿/case-results.json",
        }
        manifest = {
            "research_id": research_id,
            "case_name": args.case,
            "question": args.question,
            "research_type": args.type,
            "applicable_date": args.applicable_date or None,
            "cutoff_date": args.cutoff_date or datetime.date.today().isoformat(),
            "queries": [],
            "sources_used": [
                {"source": "ima", "status": "pending"},
                {"source": "yuandian", "status": "pending"},
                {"source": "official-web", "status": "pending"},
                {"source": "paid-db", "status": "not_used"},
            ],
            "artifact_paths": paths,
            "created_at": created,
            "harness": args.harness,
            "model_profile": args.model_profile or None,
            "verification_status": "draft",
            "sha256": {},
        }
        instruction = (
            f"# 执行说明\n\n- 检索编号：{research_id}\n- 检索问题：{args.question}\n"
            f"- 检索类型：{args.type}\n- 案件适用时点：{args.applicable_date or '待核'}\n"
            f"- 检索截止日：{manifest['cutoff_date']}\n- 执行端：{args.harness}\n\n"
            "## 处理记录\n\n按 IMA → 元典 → 官方来源顺序记录检索条件、命中与未命中；仅在用户点名或公开来源不足时补充 paid-db。\n"
        )
        report = f"# 检索报告\n\n## 检索问题\n\n{args.question}\n\n## 结论\n\n待完成。\n"
        atomic_write(task / "00-执行说明.md", instruction.encode("utf-8"), file_digest(task / "00-执行说明.md"))
        atomic_write(task / "research-manifest.json", dump_json_bytes(manifest), file_digest(task / "research-manifest.json"))
        atomic_write(task / paths["report"], report.encode("utf-8"), file_digest(task / paths["report"]))
        atomic_write(task / paths["law_results"], b"[]\n", file_digest(task / paths["law_results"]))
        atomic_write(task / paths["case_results"], b"[]\n", file_digest(task / paths["case_results"]))
    print(json.dumps({"research_id": research_id, "task_dir": str(task)}, ensure_ascii=False))


def save_raw(args: argparse.Namespace) -> None:
    task = Path(args.task).resolve()
    manifest = load_json(task / "research-manifest.json")
    if not manifest:
        raise SystemExit("未找到 research-manifest.json")
    input_path = Path(args.input).resolve()
    if input_path == task or task in input_path.parents:
        raise SystemExit("原始响应输入文件不得放在检索任务目录内；请先保存到系统临时目录，脱敏后再写入任务目录")
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    cleaned = paid_db_metadata(payload, args) if args.source == "paid-db" else sanitize(payload)
    target_dir = task / "10-中间转换" / "raw" / args.source
    target_dir.mkdir(parents=True, exist_ok=True)
    sequence = len(list(target_dir.glob("*.json"))) + 1
    target = target_dir / f"{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}-{sequence:03d}.json"
    atomic_write(target, dump_json_bytes(cleaned), file_digest(target))
    update_source_metadata(task, source_metadata(args.source, payload, args))
    print(str(target))


def record_source(args: argparse.Namespace) -> None:
    task = Path(args.task).resolve()
    if not (task / "research-manifest.json").exists():
        raise SystemExit("未找到 research-manifest.json")
    metadata = {"source": args.source, "status": args.status or "not_available"}
    if args.provider:
        metadata["provider"] = args.provider
    if args.database_name:
        metadata["database_name"] = args.database_name
    if args.retrieved_at:
        metadata["retrieved_at"] = args.retrieved_at
    update_source_metadata(task, metadata)
    print(json.dumps(metadata, ensure_ascii=False))


def find_case_dir(task: Path) -> Path:
    for parent in [task] + list(task.parents):
        if parent.name == "01-过程稿":
            return parent.parent
    raise ValueError("任务目录不在案件的 01-过程稿 下")


def finalize_task(args: argparse.Namespace) -> None:
    task = Path(args.task).resolve()
    case_dir = find_case_dir(task)
    manifest_path = task / "research-manifest.json"
    manifest = load_json(manifest_path)
    if not manifest:
        raise SystemExit("未找到 research-manifest.json")
    assert_redacted_tree(task / "10-中间转换" / "raw")
    hashes = {}
    for label, relative in manifest.get("artifact_paths", {}).items():
        path = task / relative
        if not path.exists():
            raise SystemExit(f"缺少检索成果：{path}")
        if path.suffix == ".json":
            json.loads(path.read_text(encoding="utf-8"))
        hashes[label] = sha256_file(path)
    manifest["verification_status"] = args.verification_status
    manifest["completed_at"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    manifest["sha256"] = hashes
    before_manifest = file_digest(manifest_path)
    atomic_write(manifest_path, dump_json_bytes(manifest), before_manifest)

    state_path = case_dir / "_case_state.json"
    snap = snapshot(state_path)
    state = dict(snap["data"])
    state.setdefault("research_artifacts", [])
    pointer = {
        "artifact_id": manifest["research_id"],
        "research_type": manifest["research_type"],
        "question": manifest["question"],
        "path": str(task.relative_to(case_dir)),
        "applicable_date": manifest.get("applicable_date"),
        "created_at": manifest["created_at"],
        "harness": manifest["harness"],
        "sha256": sha256_file(manifest_path),
        "verification_status": manifest["verification_status"],
    }
    state["research_artifacts"] = [
        item for item in state["research_artifacts"] if item.get("artifact_id") != pointer["artifact_id"]
    ] + [pointer]
    state["updated_at"] = datetime.date.today().isoformat()
    commit(state_path, snap["sha256"], state, args.actor, manifest["research_id"])
    append_note(
        case_dir,
        f"[{datetime.date.today().isoformat()} · 检索] {manifest['question']}\n"
        f"  状态：{manifest['verification_status']}；成果：{pointer['path']}/20-过程稿/检索报告.md",
    )
    print(json.dumps(pointer, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    create = commands.add_parser("init")
    create.add_argument("--root", default=ROOT_DEFAULT)
    create.add_argument("--case", required=True)
    create.add_argument("--type", required=True, choices=sorted(TYPE_NAMES))
    create.add_argument("--question", required=True)
    create.add_argument("--applicable-date", default="")
    create.add_argument("--cutoff-date", default="")
    create.add_argument("--harness", required=True, choices=["workbuddy", "myagents", "codex", "dsh"])
    create.add_argument("--model-profile", default="")
    raw = commands.add_parser("save-raw")
    raw.add_argument("--task", required=True)
    raw.add_argument("--source", required=True, choices=["ima", "yuandian", "official-web", "paid-db"])
    raw.add_argument("--input", required=True)
    add_source_metadata_args(raw)
    source = commands.add_parser("record-source")
    source.add_argument("--task", required=True)
    source.add_argument("--source", required=True, choices=["ima", "yuandian", "official-web", "paid-db"])
    add_source_metadata_args(source)
    done = commands.add_parser("finalize")
    done.add_argument("--task", required=True)
    done.add_argument("--verification-status", required=True, choices=["verified", "partially_verified", "unverified"])
    done.add_argument("--actor", required=True, choices=["workbuddy", "myagents", "codex", "dsh"])
    args = parser.parse_args()
    if args.action == "init":
        init_task(args)
    elif args.action == "save-raw":
        save_raw(args)
    elif args.action == "record-source":
        record_source(args)
    else:
        finalize_task(args)


if __name__ == "__main__":
    main()
