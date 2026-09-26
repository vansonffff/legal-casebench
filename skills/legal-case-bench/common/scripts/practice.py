#!/usr/bin/env python3
"""律师确认后，将可追溯的办案经验沉淀到工作区 _practice。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from casebench_v4 import find, records
from matter_io import MatterError, MatterInvalid, _yaml_module, load_matter_state, now_timestamp
from workspace_io import atomic_write, dump_json_bytes, file_digest, load_json, workspace_lock


def _paths(root: Path) -> tuple[Path, Path, Path]:
    base = root / "_practice"
    return base / "_index.json", base / "authorities", base / "notes"


def load_index(root: Path) -> dict:
    index_path, _authorities, _notes = _paths(root)
    value = load_json(index_path, {"schema_version": 1, "authority_sequence": 0,
                                   "note_sequence": 0, "authorities": [], "notes": []})
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise MatterInvalid("Practice index 无效")
    if not isinstance(value.get("authorities"), list) or not isinstance(value.get("notes"), list):
        raise MatterInvalid("Practice index 数组无效")
    return value


def _normalize_authority(item: dict) -> str:
    kind = item.get("type")
    if kind == "case":
        number = item.get("case_number", "")
        if not isinstance(number, str) or not number.strip():
            raise MatterInvalid("案例 Authority 缺 case_number")
        return "case:" + re.sub(r"\s+", "", number).translate(str.maketrans("（）", "()"))
    if kind == "statute":
        title, locator = item.get("title", ""), item.get("locator", "")
        if not isinstance(title, str) or not title.strip() or not isinstance(locator, str) or not locator.strip():
            raise MatterInvalid("法条 Authority 需要 title 和 locator")
        return "statute:" + re.sub(r"\s+", "", title + ":" + locator)
    raise MatterInvalid("Practice Authority.type 必须是 case 或 statute")


def promote(args: argparse.Namespace) -> dict:
    if not args.confirmed_by_user:
        raise MatterInvalid("Practice Note 需要用户明确确认；先询问用户，确认后再传 --confirmed-by-user")
    root = Path(args.root).expanduser().resolve()
    matter_root, matter, state = load_matter_state(Path(args.case_dir).expanduser(), root)
    body = Path(args.body_file).read_text(encoding="utf-8").strip()
    if not body or not args.title.strip():
        raise MatterInvalid("标题与正文不得为空")
    known_issues = {x.get("issue_id") for x in state.get("issues", []) if isinstance(x, dict)}
    known_artifacts = {x.get("artifact_id") for key in ("research_artifacts", "analysis_artifacts", "final_artifacts")
                       for x in state.get(key, []) if isinstance(x, dict)}
    if set(args.issue_ref) - known_issues or set(args.artifact_ref) - known_artifacts:
        raise MatterInvalid("来源 Issue 或 Artifact 未在当前 Matter 登记")
    supplied = json.loads(Path(args.authorities_json).read_text(encoding="utf-8")) if args.authorities_json else []
    if not isinstance(supplied, list) or any(not isinstance(x, dict) for x in supplied):
        raise MatterInvalid("--authorities-json 必须是对象数组")
    authority_refs = getattr(args, "authority_ref", [])
    for identifier in authority_refs:
        reference = find(records(state, "authority_refs"), "authority_ref_id", identifier)
        historical = {key: reference[key] for key in ("type", "title", "locator", "case_number", "court", "decision_date") if key in reference}
        verification = reference.get("verification", {})
        historical["source"] = {"url": verification.get("source"), "verified_at": verification.get("verified_at"),
                                "status": verification.get("status", "unverified")}
        historical["origin"] = {"matter_id": matter["matter"]["id"], "authority_ref_id": identifier}
        supplied.append(historical)
    index_path, authority_dir, note_dir = _paths(root)
    yaml = _yaml_module()
    with workspace_lock(root):
        index = load_index(root)
        known = {x.get("exact_key"): x.get("id") for x in index["authorities"] if isinstance(x, dict)}
        staged: list[tuple[Path, bytes]] = []
        used_authorities: list[str] = []
        for item in supplied:
            exact_key = _normalize_authority(item)
            if exact_key in known:
                used_authorities.append(known[exact_key])
                continue
            index["authority_sequence"] = int(index.get("authority_sequence", 0)) + 1
            identifier = f"AUTH-{index['authority_sequence']:06d}"
            authority = dict(item)
            authority["id"] = identifier
            authority["source"] = dict(authority.get("source") or {})
            authority["source"].setdefault("verified_at", None)
            target = authority_dir / f"{identifier}.yaml"
            if target.exists():
                raise MatterInvalid(f"Practice 文件已存在：{target}")
            staged.append((target, yaml.safe_dump(authority, allow_unicode=True, sort_keys=False).encode("utf-8")))
            index["authorities"].append({"id": identifier, "type": item["type"], "exact_key": exact_key,
                                         "title": item.get("title") or item.get("case_number"),
                                         "path": f"authorities/{identifier}.yaml"})
            known[exact_key] = identifier
            used_authorities.append(identifier)
        index["note_sequence"] = int(index.get("note_sequence", 0)) + 1
        note_id = f"PN-{index['note_sequence']:06d}"
        target = note_dir / f"{note_id}.md"
        if target.exists():
            raise MatterInvalid(f"Practice 文件已存在：{target}")
        stamp = now_timestamp()
        metadata = {"id": note_id, "title": args.title.strip(),
                    "origin": {"matter_id": matter["matter"]["id"], "matter_name": matter["matter"]["name"],
                               "issue_refs": args.issue_ref, "artifact_refs": args.artifact_ref,
                               "authority_refs": authority_refs},
                    "authorities": used_authorities, "created_at": stamp, "updated_at": stamp}
        note_text = "---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + "---\n\n" + body + "\n"
        staged.append((target, note_text.encode("utf-8")))
        index["notes"].append({"id": note_id, "title": metadata["title"], "matter_id": metadata["origin"]["matter_id"],
                               "matter_name": metadata["origin"]["matter_name"], "path": f"notes/{note_id}.md",
                               "created_at": stamp, "authorities": used_authorities})
        created: list[Path] = []
        try:
            for path, content in staged:
                atomic_write(path, content, file_digest(path))
                created.append(path)
            atomic_write(index_path, dump_json_bytes(index), file_digest(index_path))
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
    return {"note_id": note_id, "authorities": used_authorities, "matter_root": str(matter_root)}


def list_notes(root: Path, query: str = "") -> list[dict]:
    if not query.strip():
        return load_index(root)["notes"]
    return [entry for entry in searchable_notes(root)
            if query.strip().casefold() in entry["search_text"].casefold()]


def searchable_notes(root: Path) -> list[dict]:
    """标题、来源、正文及关联依据使用同一只读检索语义。"""
    entries = []
    for entry in load_index(root)["notes"]:
        if not isinstance(entry, dict):
            continue
        item = dict(entry)
        try:
            shown = show_note(root, item["id"])
            item["search_text"] = " ".join([str(item.get("title") or ""), shown["body"],
                str(item.get("matter_name") or ""),
                *(str(authority.get("title") or authority.get("case_number") or "") for authority in shown["authorities"])])
        except (MatterError, OSError, ValueError, KeyError) as exc:
            item["error"] = str(exc)
            item["search_text"] = " ".join(str(item.get(key) or "") for key in ("title", "matter_name"))
        entries.append(item)
    return entries


def _read_library_file(root: Path, path: Path) -> str:
    base = (root / "_practice").resolve()
    if not base.is_relative_to(root.resolve()) or not path.resolve().is_relative_to(base):
        raise MatterInvalid("经验文件路径越过工作区")
    return path.read_text(encoding="utf-8")


def show_note(root: Path, note_id: str) -> dict:
    if not re.fullmatch(r"PN-\d{6,}", note_id):
        raise MatterInvalid("Practice Note ID 无效")
    index = load_index(root)
    entry = next((x for x in index["notes"] if isinstance(x, dict) and x.get("id") == note_id), None)
    if entry is None:
        raise MatterInvalid(f"未找到 Practice Note：{note_id}")
    _index, _authorities, note_dir = _paths(root)
    path = note_dir / f"{note_id}.md"
    text = _read_library_file(root, path)
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise MatterInvalid("Practice Note frontmatter 无效")
    head, body = text[4:].split("\n---\n", 1)
    metadata = _yaml_module().safe_load(head)
    if not isinstance(metadata, dict) or metadata.get("id") != note_id:
        raise MatterInvalid("Practice Note 身份与索引不符")
    if not isinstance(metadata.get("authorities", []), list):
        raise MatterInvalid("经验关联依据必须是数组")
    authorities = []
    for authority_id in metadata.get("authorities", []):
        if not isinstance(authority_id, str) or not re.fullmatch(r"AUTH-\d{6,}", authority_id):
            raise MatterInvalid("经验关联依据编号无效")
        path = _paths(root)[1] / f"{authority_id}.yaml"
        authority = _yaml_module().safe_load(_read_library_file(root, path))
        if not isinstance(authority, dict) or authority.get("id") != authority_id:
            raise MatterInvalid("经验关联依据身份不一致")
        _normalize_authority(authority)
        authorities.append(authority)
    return {"metadata": metadata, "body": body.strip(), "authorities": authorities,
            "reuse_notice": "历史经验仅用于研究起点，在新案件使用法条或案例前须重新联网核验。"}


def prepare_reuse(root: Path, note_id: str, authority_id: str, case_dir: Path) -> dict:
    """生成新案核验问题卡；不写目标 State，不继承历史已核验标记。"""
    _target, matter, _state = load_matter_state(case_dir, root)
    shown = show_note(root, note_id)
    authority = find(shown["authorities"], "id", authority_id)
    candidate = {key: authority[key] for key in ("type", "title", "locator", "case_number", "court", "decision_date") if key in authority}
    candidate["verification"] = {"status": "unverified", "verified_at": None, "source": None}
    return {"target_matter_id": matter["matter"]["id"], "note_id": note_id, "authority_id": authority_id,
            "origin": shown["metadata"].get("origin", {}), "authority_candidate": candidate,
            "historical_source": authority.get("source", {}), "can_cite_as_verified": False,
            "checks_required": ["联网核验官方来源与真实性", "核对当前效力、修订及相关解释",
                                "核对条文定位或案号、法院、裁判日期", "比较两案事实及本案适用性"],
            "next_step": "将本次核验报告落入当前案件；核验后通过本案依据命令另行登记。无法联网时只保留历史线索。"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    create = actions.add_parser("promote")
    create.add_argument("--root", required=True)
    create.add_argument("--case-dir", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--body-file", required=True)
    create.add_argument("--issue-ref", action="append", default=[])
    create.add_argument("--artifact-ref", action="append", default=[])
    create.add_argument("--authorities-json")
    create.add_argument("--authority-ref", action="append", default=[])
    create.add_argument("--confirmed-by-user", action="store_true")
    for action in ("list", "show", "prepare-reuse"):
        part = actions.add_parser(action)
        part.add_argument("--root", required=True)
        if action == "list":
            part.add_argument("--query", default="")
        if action in {"show", "prepare-reuse"}:
            part.add_argument("--id", required=True)
        if action == "prepare-reuse":
            part.add_argument("--authority-id", required=True)
            part.add_argument("--case-dir", required=True)
    args = parser.parse_args(argv)
    try:
        root = Path(args.root).expanduser().resolve()
        if args.action == "promote":
            result = promote(args)
        elif args.action == "list":
            result = {"notes": list_notes(root, args.query)}
        elif args.action == "prepare-reuse":
            result = prepare_reuse(root, args.id, args.authority_id, Path(args.case_dir).expanduser())
        else:
            result = show_note(root, args.id)
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0
    except (MatterError, OSError, ValueError, TypeError, RuntimeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
