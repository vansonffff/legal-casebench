#!/usr/bin/env python3
"""Proceeding、Authority Reference 与 Final Artifact 的共享命令实现。"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from casebench_v4 import allocate, find, records
from matter_io import MatterError, MatterInvalid, load_matter_state, now_timestamp
from state_update import mutate
from workspace_io import sha256_file

ACTORS = ("workbuddy", "myagents", "codex", "dsh")


def _state(case_dir: str) -> tuple[Path, dict, Path]:
    root, _matter, state = load_matter_state(Path(case_dir).expanduser())
    return root, state, root / "_case_state.json"


def _emit(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _actor(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--actor", required=True, choices=ACTORS)


def proceeding(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="管理 Matter 内的程序与庭审事件")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("add", "list", "show", "update", "add-event", "update-event"):
        part = commands.add_parser(command)
        part.add_argument("--case-dir", required=True)
        if command in {"show", "update", "add-event", "update-event"}:
            part.add_argument("--proceeding-id", required=True)
        if command == "update-event":
            part.add_argument("--event-id", required=True)
        if command in {"add", "update"}:
            part.add_argument("--name")
            part.add_argument("--case-number")
            part.add_argument("--kind")
            part.add_argument("--stage")
            part.add_argument("--status")
            part.add_argument("--court")
            part.add_argument("--party", action="append", default=[], help="姓名:角色，可重复")
        if command in {"add-event", "update-event"}:
            part.add_argument("--type")
            part.add_argument("--at")
            part.add_argument("--location")
            part.add_argument("--status")
        if command not in {"list", "show"}:
            _actor(part)
    args = parser.parse_args(argv)
    try:
        _root, state, path = _state(args.case_dir)
        if args.command == "list":
            _emit({"proceedings": records(state, "proceedings")})
            return 0
        if args.command == "show":
            _emit(find(records(state, "proceedings"), "proceeding_id", args.proceeding_id))
            return 0
        output = {}

        def apply(data: dict) -> None:
            bucket = data.setdefault("proceedings", [])
            if not isinstance(bucket, list):
                raise MatterInvalid("proceedings 必须是数组")
            if args.command == "add":
                if not args.name or not args.name.strip():
                    raise MatterInvalid("新增关联案件需要非空 --name")
                item = {"proceeding_id": allocate(data, "proceeding"), "name": args.name.strip(),
                        "case_number": args.case_number or "", "kind": args.kind or "litigation",
                        "stage": args.stage or "unknown", "status": args.status or "active",
                        "court": args.court or "", "parties": _parties(args.party), "events": []}
                bucket.append(item)
                output.update(item)
                return
            item = find(bucket, "proceeding_id", args.proceeding_id)
            if args.command == "update":
                for key in ("name", "case_number", "kind", "stage", "status", "court"):
                    value = getattr(args, key.replace("-", "_"), None)
                    if value is not None:
                        if key == "name" and not value.strip():
                            raise MatterInvalid("name 不得为空")
                        item[key] = value
                if args.party:
                    item["parties"] = _parties(args.party)
                output.update(item)
                return
            events = item.setdefault("events", [])
            if not isinstance(events, list):
                raise MatterInvalid("events 必须是数组")
            if args.command == "add-event":
                if not args.type or not args.at:
                    raise MatterInvalid("新增事件需要 --type 和 --at")
                from datetime import datetime
                if datetime.fromisoformat(args.at).tzinfo is None:
                    raise MatterInvalid("--at 必须带时区偏移")
                existing = [event for proceeding_item in bucket if isinstance(proceeding_item, dict)
                            for event in proceeding_item.get("events", []) if isinstance(event, dict)]
                event = {"event_id": allocate(data, "event", existing), "type": args.type,
                         "at": args.at, "location": args.location, "status": args.status or "scheduled"}
                events.append(event)
                output.update(event)
                return
            event = find(events, "event_id", args.event_id)
            for key in ("type", "at", "location", "status"):
                value = getattr(args, key)
                if value is not None:
                    if key == "at":
                        from datetime import datetime
                        if datetime.fromisoformat(value).tzinfo is None:
                            raise MatterInvalid("--at 必须带时区偏移")
                    event[key] = value
            output.update(event)

        mutate(path, args.actor, args.command, apply)
        _emit(output)
        return 0
    except (MatterError, OSError, ValueError, RuntimeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


def _parties(raw: list[str]) -> list[dict[str, str]]:
    result = []
    for text in raw:
        name, sep, role = text.partition(":")
        if not sep or not name.strip() or not role.strip():
            raise MatterInvalid("--party 格式为 姓名:角色")
        result.append({"name": name.strip(), "role": role.strip()})
    return result


def authority(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="登记本案法律依据与核验状态")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("add", "list", "verify"):
        part = commands.add_parser(command)
        part.add_argument("--case-dir", required=True)
        if command == "add":
            part.add_argument("--type", required=True, choices=("statute", "case"))
            part.add_argument("--title")
            part.add_argument("--locator")
            part.add_argument("--case-number")
            part.add_argument("--court")
            part.add_argument("--decision-date")
            part.add_argument("--proposition")
        if command == "verify":
            part.add_argument("--authority-ref-id", required=True)
            part.add_argument("--status", required=True, choices=("verified", "partially_verified", "unverified"))
            part.add_argument("--source", required=True)
        if command != "list":
            _actor(part)
    args = parser.parse_args(argv)
    try:
        _root, state, path = _state(args.case_dir)
        if args.command == "list":
            _emit({"authority_refs": records(state, "authority_refs")})
            return 0
        output = {}

        def apply(data: dict) -> None:
            bucket = data.setdefault("authority_refs", [])
            if not isinstance(bucket, list):
                raise MatterInvalid("authority_refs 必须是数组")
            if args.command == "add":
                if args.type == "statute" and (not args.title or not args.locator):
                    raise MatterInvalid("法条需要 --title 和 --locator")
                if args.type == "case" and not args.case_number:
                    raise MatterInvalid("案例需要 --case-number")
                item = {"authority_ref_id": allocate(data, "authority_ref"), "type": args.type,
                        "verification": {"status": "unverified", "verified_at": None, "source": None}}
                for key in ("title", "locator", "case_number", "court", "decision_date", "proposition"):
                    value = getattr(args, key)
                    if value is not None:
                        item[key] = value
                bucket.append(item)
                output.update(item)
                return
            item = find(bucket, "authority_ref_id", args.authority_ref_id)
            item["verification"] = {"status": args.status,
                                    "verified_at": now_timestamp() if args.status != "unverified" else None,
                                    "source": args.source}
            output.update(item)

        mutate(path, args.actor, args.command, apply)
        _emit(output)
        return 0
    except (MatterError, OSError, ValueError, RuntimeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


def final_artifact(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="登记 02-定稿/ 中的已完成文件")
    commands = parser.add_subparsers(dest="command", required=True)
    register = commands.add_parser("register")
    register.add_argument("--case-dir", required=True)
    register.add_argument("--path", required=True, help="相对 Matter Root 的 02-定稿/ 文件路径")
    register.add_argument("--title")
    register.add_argument("--kind", default="legal_document")
    _actor(register)
    listing = commands.add_parser("list")
    listing.add_argument("--case-dir", required=True)
    args = parser.parse_args(argv)
    try:
        root, state, path = _state(args.case_dir)
        if args.command == "list":
            _emit({"final_artifacts": records(state, "final_artifacts")})
            return 0
        relative = Path(args.path)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or relative.parts[0] != "02-定稿":
            raise MatterInvalid("定稿路径必须位于 Matter Root 的 02-定稿/ 内")
        target = root / relative
        if target.is_symlink() or not target.resolve().is_relative_to((root / "02-定稿").resolve()) or not target.is_file():
            raise MatterInvalid("定稿文件不存在或路径不安全")
        digest = sha256_file(target)
        output = {}

        def apply(data: dict) -> None:
            bucket = data.setdefault("final_artifacts", [])
            if not isinstance(bucket, list):
                raise MatterInvalid("final_artifacts 必须是数组")
            if any(isinstance(item, dict) and item.get("path") == relative.as_posix() and item.get("sha256") == digest for item in bucket):
                raise MatterInvalid("相同文件版本已登记")
            if sha256_file(target) != digest:
                raise RuntimeError("定稿文件登记前已改变，请重试")
            item = {"artifact_id": allocate(data, "final_artifact"), "title": args.title or target.stem,
                    "path": relative.as_posix(), "kind": args.kind, "finalized_at": now_timestamp(), "sha256": digest}
            bucket.append(item)
            output.update(item)

        mutate(path, args.actor, "final-register", apply)
        _emit(output)
        return 0
    except (MatterError, OSError, ValueError, RuntimeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
