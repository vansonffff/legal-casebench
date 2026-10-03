#!/usr/bin/env python3
"""CaseBench Core 的统一只读 JSON 视图；不修改 Matter、Registry 或 Practice。"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

from matter_io import MatterError, MatterNotFound, load_matter_state, validate_matter, resolve_matter_root
from practice import searchable_notes, show_note
from registry_io import load_registry, registry_version

VIEW_VERSION = 2

# 展示层不做归一，只做退化：同一 schema v4 下真实案件存在多种字段词汇，
# 视图按顺序探测并原样输出，缺失时置空由前端显示"待确认"，不推断、不补造。
FACT_TEXT_KEYS = ("text", "statement")
FACT_SOURCE_KEYS = ("sources", "source")
ISSUE_ID_KEYS = ("issue_id", "legacy_issue_id")
PENDING_TITLE_KEYS = ("item", "title")
PENDING_ID_KEYS = ("id", "item_id")
PENDING_ORIGIN_KEYS = ("origin", "note")


def _first(record: dict, keys: tuple[str, ...]) -> object:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _as_list(value: object) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _issue_identity(record: dict) -> str | None:
    for key in ISSUE_ID_KEYS:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _fact_ref(record: dict) -> str | None:
    for key in ("fact_id", "id"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _pointer_item(root: Path, item: object, kind: str) -> dict:
    """成果只带指针，不复制正文；缺失字段保持 None，由前端标"待确认"。"""

    if not isinstance(item, dict):
        return {"artifact_id": None, "kind": kind, "title": None, "path": None, "at": None}
    return {"artifact_id": item.get("artifact_id"), "kind": kind,
            "title": item.get("title") or item.get("question") or item.get("artifact_id"),
            "path": _safe_artifact_path(root, item.get("path")),
            "at": item.get("created_at") or item.get("finalized_at")}


def _fact_view(record: object) -> dict:
    if not isinstance(record, dict):
        return {"fact_id": None, "text": None, "kind": None, "material_grade": None,
                "verification": None, "source_party": None, "sources": [],
                "conflicts_with": [], "supersedes": [], "degraded": True}
    verification = record.get("verification")
    if isinstance(verification, dict):
        verification_view = {"form": "record", "status": verification.get("status"),
                             "method": verification.get("method"), "checked_at": verification.get("checked_at")}
    elif isinstance(verification, str) and verification.strip():
        verification_view = {"form": "legacy_string", "status": verification.strip()}
    else:
        verification_view = None
    text = _first(record, FACT_TEXT_KEYS)
    return {"fact_id": _fact_ref(record), "text": text, "kind": record.get("kind"),
            "material_grade": record.get("material_grade"), "verification": verification_view,
            "source_party": record.get("source_party"),
            "sources": _as_list(_first(record, FACT_SOURCE_KEYS)),
            "conflicts_with": _as_list(record.get("conflicts_with")),
            "supersedes": _as_list(record.get("supersedes")),
            "degraded": text is None or record.get("kind") in (None, "legacy_unclassified")}


def _issue_fact_refs(record: dict) -> list:
    """争点关联的事实引用，两个来源都读。

    规范写法是 `fact_refs`（`FACT-` 前缀）。存量案件还有另一种写法：关联事实记在
    `sources` 里，且用的是事实自身编号（形如 `F-002`）而非规范引用。两者都读，
    缺失即空，不补造、不改写案件。
    """

    refs = list(_as_list(record.get("fact_refs")))
    for extra in _as_list(record.get("sources")):
        if isinstance(extra, str) and extra.strip() and extra.strip() not in refs:
            refs.append(extra.strip())
    return refs


def _issue_view(record: object) -> dict:
    if not isinstance(record, dict):
        return {"issue_id": None, "title": None, "status": None, "category": None,
                "current_position": None, "counterarguments": [], "evidence_gaps": [], "next_actions": [],
                "fact_refs": [], "research_refs": [], "analysis_refs": [], "display_id": None,
                "note": None, "degraded": True}
    identity = _issue_identity(record)
    title = record.get("title")
    question = record.get("question")
    position = record.get("current_position")
    note = record.get("note")
    return {"issue_id": identity, "title": title if isinstance(title, str) and title.strip() else question,
            "status": record.get("status"), "category": record.get("category"),
            "current_position": position if isinstance(position, dict) else None,
            "counterarguments": _as_list(record.get("counterarguments")),
            "evidence_gaps": _as_list(record.get("evidence_gaps")),
            "next_actions": _as_list(record.get("next_actions")),
            "fact_refs": _issue_fact_refs(record),
            "research_refs": _as_list(record.get("research_refs")),
            "analysis_refs": _as_list(record.get("analysis_refs")),
            "display_id": record.get("id"),
            # `note` 不在 State v4 契约里（契约只有 current_position），但真实案件的办案记录
            # 大多写在这里（实测 5 案 17 条争点，current_position.summary 全为空、note 全有内容）。
            # 原样带出供展示，绝不并入 current_position：那是两种东西。
            "note": note if isinstance(note, str) and note.strip() else None,
            "degraded": identity is None or not isinstance(title, str) or not title.strip()}


def _pending_view(record: object) -> dict:
    if not isinstance(record, dict):
        return {"item_id": None, "title": None, "status": None, "origin": None,
                "priority": None, "due": None, "issue_ref": None, "degraded": True}
    title = _first(record, PENDING_TITLE_KEYS)
    return {"item_id": _first(record, PENDING_ID_KEYS), "title": title, "status": record.get("status"),
            "origin": _first(record, PENDING_ORIGIN_KEYS), "priority": record.get("priority"),
            "due": record.get("due"), "issue_ref": record.get("issue_ref"),
            "degraded": title is None or record.get("status") in (None, "")}


def _semantic_projection(state: dict, facts: list[dict], issues: list[dict], pending: list[dict]) -> dict:
    """状态哈希的输入：规范化语义子集，不含高水位、updated_at 与文件格式。

    文件字节哈希会被 sequences 高水位、时间戳与格式重排触发，令引用频繁误报
    "状态已变化"；这里只取身份与三类条目的语义内容，同一状态稳定得到同一哈希。
    """

    return {
        "matter_id": state.get("matter_id"),
        "facts": sorted([{"fact_id": item["fact_id"], "text": item["text"], "kind": item["kind"],
                          "material_grade": item["material_grade"], "sources": item["sources"],
                          "verification": item["verification"], "source_party": item["source_party"],
                          "supersedes": item["supersedes"], "conflicts_with": item["conflicts_with"]}
                         for item in facts], key=lambda item: str(item["fact_id"])),
        "issues": sorted([{"issue_id": item["issue_id"], "title": item["title"], "status": item["status"],
                           "category": item["category"], "fact_refs": item["fact_refs"],
                           "research_refs": item["research_refs"], "analysis_refs": item["analysis_refs"],
                           # 立场与办案备注都是争点的实质内容：改动它们，引用就应该提示"状态已变化"。
                           "current_position": item["current_position"],
                           "counterarguments": item["counterarguments"],
                           "evidence_gaps": item["evidence_gaps"],
                           "next_actions": item["next_actions"],
                           "note": item["note"]}
                          for item in issues], key=lambda item: str(item["issue_id"])),
        "pending_items": sorted([{"item_id": item["item_id"], "title": item["title"], "status": item["status"],
                                  "issue_ref": item["issue_ref"], "due": item["due"]}
                                 for item in pending], key=lambda item: str(item["item_id"])),
    }


def _state_hash(projection: dict) -> str:
    payload = json.dumps(projection, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _collections(state: dict) -> tuple[list[dict], list[dict], list[dict]]:
    return ([item for item in state.get("facts", []) if isinstance(item, dict)],
            [item for item in state.get("issues", []) if isinstance(item, dict)],
            [item for item in state.get("pending_items", []) if isinstance(item, dict)])


def _facts_map(facts: list[dict]) -> dict[str, dict]:
    result = {}
    for record in facts:
        reference = _fact_ref(record)
        if reference:
            result.setdefault(reference, record)
    return result


def _context_view(case_dir: Path) -> dict:
    """只读案件上下文：三类条目 + 计数 + 读取时间 + 规范化状态哈希。"""

    root, document, state = load_matter_state(case_dir, strict=False)
    facts_raw, issues_raw, pending_raw = _collections(state)
    facts = [_fact_view(record) for record in facts_raw]
    issues = [_issue_view(record) for record in issues_raw]
    pending = [_pending_view(record) for record in pending_raw]
    projection = _semantic_projection(state, facts, issues, pending)
    warnings = validate_matter(root)
    unresolved = [item["fact_id"] or f"facts[{index}]" for index, item in enumerate(facts) if item["degraded"]]
    unfinished = [item for item in pending if str(item["status"] or "").strip().lower()
                  not in ("completed", "done", "closed", "已完成", "已关闭", "已办结")]
    return {"view_version": VIEW_VERSION, "matter": {"id": document["matter"]["id"], "name": document["matter"]["name"],
                                                     "path": str(root)},
            "read_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "state_hash": _state_hash(projection),
            "facts": facts, "issues": issues, "pending_items": pending,
            "counts": {"facts": len(facts), "issues": len(issues), "pending_items": len(pending),
                       "pending_open": len(unfinished)},
            "degraded": {"facts": unresolved},
            "warnings": warnings}


def _issue_snapshot(case_dir: Path, issue_id: str) -> dict:
    """单条争点的自包含引用快照；只带成果指针，不复制报告正文。"""

    root, document, state = load_matter_state(case_dir, strict=False)
    facts_raw, issues_raw, pending_raw = _collections(state)
    facts = [_fact_view(record) for record in facts_raw]
    issues = [_issue_view(record) for record in issues_raw]
    pending = [_pending_view(record) for record in pending_raw]
    target = next((item for item in issues if item["issue_id"] == issue_id), None)
    if target is None:
        known = [item["issue_id"] for item in issues if item["issue_id"]]
        raise ValueError(f"未找到争点 {issue_id}；本案已知争点：{'、'.join(known) if known else '无'}")
    facts_by_ref = _facts_map(facts_raw)
    related_facts = []
    for reference in target["fact_refs"]:
        record = facts_by_ref.get(str(reference))
        related_facts.append(_fact_view(record) if record is not None else
                             {"fact_id": str(reference), "text": None, "kind": None, "material_grade": None,
                              "verification": None, "source_party": None, "sources": [],
                              "conflicts_with": [], "supersedes": [], "degraded": True, "missing": True})
    research = [_pointer_item(root, item, "research") for item in state.get("research_artifacts", [])]
    analysis = [_pointer_item(root, item, "analysis") for item in state.get("analysis_artifacts", [])]
    by_artifact = {item["artifact_id"]: item for item in research + analysis if item["artifact_id"]}
    return {"view_version": VIEW_VERSION,
            "matter": {"id": document["matter"]["id"], "name": document["matter"]["name"], "path": str(root)},
            "issue": target,
            "related_facts": related_facts,
            "related_pending_items": [item for item in pending
                                      if item["issue_ref"] == issue_id
                                      or str(item["origin"] or "").find(issue_id) >= 0],
            "artifact_pointers": {"research": [by_artifact.get(str(ref), {"artifact_id": str(ref), "kind": "research",
                                                                          "title": None, "path": None, "at": None,
                                                                          "missing": True})
                                               for ref in target["research_refs"]],
                                  "analysis": [by_artifact.get(str(ref), {"artifact_id": str(ref), "kind": "analysis",
                                                                          "title": None, "path": None, "at": None,
                                                                          "missing": True})
                                               for ref in target["analysis_refs"]]},
            "read_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "state_hash": _state_hash(_semantic_projection(state, facts, issues, pending))}


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
    facts_raw, issues_raw, pending_raw = _collections(state)
    facts = [_fact_view(record) for record in facts_raw]
    issues = [_issue_view(record) for record in issues_raw]
    pending = [_pending_view(record) for record in pending_raw]
    unfinished = [item for item in pending if str(item["status"] or "").strip().lower()
                  not in ("completed", "done", "closed", "已完成", "已关闭", "已办结")]
    return {"view_version": VIEW_VERSION, "matter": matter, "proceedings": proceedings,
            "proceeding_count": len(proceedings), "next_event": events[0] if events else None,
            "recent_artifacts": recent, "final_artifacts": finals, "authority_refs": authorities,
            "authority_count": len(authorities), "final_artifact_count": len(finals),
            "facts": facts, "issues": issues, "pending_items": pending,
            "counts": {"facts": len(facts), "issues": len(issues), "pending_items": len(pending),
                       "pending_open": len(unfinished)},
            "state_hash": _state_hash(_semantic_projection(state, facts, issues, pending)),
            "warnings": warnings}


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
    context = commands.add_parser("context")
    context.add_argument("--case-dir", required=True)
    resolve_context = commands.add_parser("resolve-context")
    resolve_context.add_argument("--start", required=True)
    resolve_context.add_argument("--boundary", required=True)
    for name in ("quote-issue", "reference"):
        part = commands.add_parser(name)
        part.add_argument("--case-dir", required=True)
        part.add_argument("--issue-id", required=True)
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
        elif args.command == "context":
            result = _context_view(Path(args.case_dir).expanduser())
        elif args.command == "resolve-context":
            try:
                target = resolve_matter_root(args.start, args.boundary)
                result = {"status": "ready", "context": _context_view(target)}
            except MatterNotFound:
                result = {"status": "missing"}
        elif args.command in ("quote-issue", "reference"):
            # 两个子命令返回同构快照：quote-issue 供面板在插入前调用（调用方再核对哈希），
            # reference 供 Host 在模型准备阶段展开引用；身份与哈希由 Host 核对。
            result = _issue_snapshot(Path(args.case_dir).expanduser(), args.issue_id)
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
