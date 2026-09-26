#!/usr/bin/env python3
"""CaseBench Core 的统一只读 JSON 视图；不修改 Matter、Registry 或 Practice。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from matter_io import MatterError, load_matter_state, validate_matter
from practice import searchable_notes, show_note
from registry_io import load_registry, registry_version

VIEW_VERSION = 1


def _time(value: object) -> datetime:
    if not isinstance(value, str) or not value:
        return datetime.min
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone().replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        return datetime.min


def _finals(root: Path, state: dict) -> list[dict]:
    if "final_artifacts" in state:
        return state["final_artifacts"] if isinstance(state["final_artifacts"], list) else []
    final_dir = root / "02-定稿"
    if not final_dir.is_dir():
        return []
    result = []
    for path in sorted(final_dir.rglob("*")):
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(final_dir.resolve()):
            continue
        result.append({"artifact_id": None, "title": path.stem, "path": path.relative_to(root).as_posix(),
                       "kind": "legacy_file", "finalized_at": datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(),
                       "sha256": None, "source": "02-定稿/"})
    return result


def _safe_artifact_path(root: Path, value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    target = Path(value)
    if not target.is_absolute():
        target = root / target
    return value if target.resolve().is_relative_to(root.resolve()) else None


def _events(proceedings: list) -> list[dict]:
    result = []
    for proceeding in proceedings:
        if not isinstance(proceeding, dict):
            continue
        for event in proceeding.get("events", []):
            if isinstance(event, dict):
                result.append({**event, "proceeding_id": proceeding.get("proceeding_id")})
    return result


def matter_view(case_dir: Path) -> dict:
    root, document, state = load_matter_state(case_dir, strict=False)
    warnings = validate_matter(root)
    proceedings = state.get("proceedings", [])
    authorities = state.get("authority_refs", [])
    finals = _finals(root, state)
    events = [x for x in _events(proceedings) if x.get("status", "scheduled") == "scheduled" and _time(x.get("at")) >= datetime.now()]
    events.sort(key=lambda x: _time(x.get("at")))
    recent = []
    for field, kind in (("research_artifacts", "research"), ("analysis_artifacts", "analysis")):
        for item in state.get(field, []):
            if isinstance(item, dict):
                recent.append({"artifact_id": item.get("artifact_id"), "kind": kind,
                               "title": item.get("title") or item.get("question") or item.get("artifact_id"),
                               "path": _safe_artifact_path(root, item.get("path")),
                               "at": item.get("created_at") or item.get("finalized_at")})
    for item in finals:
        recent.append({"artifact_id": item.get("artifact_id"), "kind": "final", "title": item.get("title"),
                       "path": item.get("path"), "at": item.get("finalized_at")})
    recent.sort(key=lambda x: _time(x.get("at")), reverse=True)
    matter = {"id": document["matter"]["id"], "name": document["matter"]["name"],
              "type": document["matter"].get("type"), "status": document["matter"].get("status"),
              "role": document.get("engagement", {}).get("role"),
              "represented_party": document.get("engagement", {}).get("represented_party"),
              "stage": document.get("procedure", {}).get("stage"), "path": str(root)}
    return {"view_version": VIEW_VERSION, "matter": matter, "proceedings": proceedings,
            "proceeding_count": len(proceedings), "next_event": events[0] if events else None,
            "recent_artifacts": recent, "final_artifacts": finals, "authority_refs": authorities,
            "authority_count": len(authorities), "final_artifact_count": len(finals), "warnings": warnings}


def workspace_view(root: Path) -> dict:
    registry = load_registry(root / "_registry.json")
    if registry is None:
        raise ValueError("未找到 _registry.json")
    if registry_version(registry) != 2 or not isinstance(registry.get("matters"), list):
        raise ValueError("需要 Registry v2 的 matters[]")
    matters = []
    for entry in registry["matters"]:
        if not isinstance(entry, dict):
            matters.append({"status": "error", "error": "Registry 条目不是对象"})
            continue
        path = Path(str(entry.get("product_dir", ""))).expanduser()
        if not path.is_absolute():
            path = root / path
        if not path.resolve().is_relative_to(root.resolve()):
            matters.append({"matter_id": entry.get("matter_id"), "name": entry.get("name"),
                            "status": "error", "error": "Matter 路径越过工作区"})
            continue
        try:
            view = matter_view(path)
            if view["matter"]["id"] != entry.get("matter_id"):
                raise ValueError("Registry 与 Matter ID 不一致")
            matters.append({"matter_id": view["matter"]["id"], "name": view["matter"]["name"],
                            "path": view["matter"]["path"], "type": view["matter"]["type"],
                            "role": view["matter"]["role"], "stage": view["matter"]["stage"],
                            "proceeding_count": view["proceeding_count"], "next_event": view["next_event"],
                            "recent_artifact": view["recent_artifacts"][0] if view["recent_artifacts"] else None,
                            "status": "ok"})
        except (MatterError, OSError, ValueError) as exc:
            matters.append({"matter_id": entry.get("matter_id"), "name": entry.get("name"),
                            "status": "error", "error": str(exc)})
    return {"view_version": VIEW_VERSION, "workspace_root": str(root), "matter_count": len(matters), "matters": matters}


def practice_list_view(root: Path) -> dict:
    return {"view_version": VIEW_VERSION, "notes": searchable_notes(root)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    workspace = commands.add_parser("workspace")
    workspace.add_argument("--root", required=True)
    matter = commands.add_parser("matter")
    matter.add_argument("--case-dir", required=True)
    for name in ("practice-list", "practice-show"):
        part = commands.add_parser(name)
        part.add_argument("--root", required=True)
        if name == "practice-show":
            part.add_argument("--id", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "workspace":
            result = workspace_view(Path(args.root).expanduser().resolve())
        elif args.command == "matter":
            result = matter_view(Path(args.case_dir).expanduser())
        elif args.command == "practice-list":
            result = practice_list_view(Path(args.root).expanduser().resolve())
        else:
            result = {"view_version": VIEW_VERSION, **show_note(Path(args.root).expanduser().resolve(), args.id)}
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0
    except (MatterError, OSError, ValueError, TypeError) as exc:
        print(json.dumps({"view_version": VIEW_VERSION, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
