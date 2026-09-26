#!/usr/bin/env python3
"""CaseBench 4.0 可选状态域的共同校验与编号逻辑。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from matter_io import MatterInvalid, record_sequence, recorded_sequence

IDS = {
    "proceeding": ("proceedings", "proceeding_id", "PROC"),
    "event": ("events", "event_id", "EVT"),
    "authority_ref": ("authority_refs", "authority_ref_id", "AREF"),
    "final_artifact": ("final_artifacts", "artifact_id", "FINAL"),
}


def records(state: dict, field: str) -> list:
    value = state.get(field, [])
    if not isinstance(value, list):
        raise MatterInvalid(f"{field} 必须是数组")
    return value


def allocate(state: dict, kind: str, items: list | None = None) -> str:
    field, key, prefix = IDS[kind]
    values = records(state, field) if items is None else items
    highest = recorded_sequence(state, kind)
    for item in values:
        if isinstance(item, dict):
            found = item.get(key)
            if isinstance(found, str) and re.fullmatch(rf"{prefix}-\d{{4,}}", found):
                highest = max(highest, int(found.split("-")[-1]))
    allocated = f"{prefix}-{highest + 1:04d}"
    record_sequence(state, kind, allocated)
    return allocated


def find(items: list, key: str, value: str) -> dict:
    for item in items:
        if isinstance(item, dict) and item.get(key) == value:
            return item
    raise MatterInvalid(f"未找到 {key}={value}")


def validate_extensions(state: dict[str, Any]) -> list[str]:
    """旧 State 无新字段仍合法；出现新字段时验证最小可用结构。"""

    errors: list[str] = []
    all_event_ids: set[str] = set()
    for field, key, prefix in IDS.values():
        if field == "events":
            continue
        values = state.get(field, [])
        if not isinstance(values, list):
            errors.append(f"{field} 必须是数组")
            continue
        seen: set[str] = set()
        for index, item in enumerate(values):
            if not isinstance(item, dict):
                errors.append(f"{field}[{index}] 必须是对象")
                continue
            identifier = item.get(key)
            if not isinstance(identifier, str) or not re.fullmatch(rf"{prefix}-\d{{4,}}", identifier):
                errors.append(f"{field}[{index}].{key} 编号无效")
            elif identifier in seen:
                errors.append(f"{field} 编号重复：{identifier}")
            else:
                seen.add(identifier)
            if field == "proceedings":
                if not isinstance(item.get("name"), str) or not item["name"].strip():
                    errors.append(f"{identifier}.name 必须是非空字符串")
                if "parties" in item and not isinstance(item["parties"], list):
                    errors.append(f"{identifier}.parties 必须是数组")
                events = item.get("events", [])
                if not isinstance(events, list):
                    errors.append(f"{identifier}.events 必须是数组")
                else:
                    event_ids: set[str] = set()
                    for event in events:
                        if not isinstance(event, dict) or not re.fullmatch(r"EVT-\d{4,}", str(event.get("event_id", ""))):
                            errors.append(f"{identifier}.events 含无效 Event")
                            continue
                        event_id = event["event_id"]
                        if event_id in event_ids:
                            errors.append(f"{identifier}.events 编号重复：{event_id}")
                        event_ids.add(event_id)
                        if event_id in all_event_ids:
                            errors.append(f"Event 编号跨 Proceeding 重复：{event_id}")
                        all_event_ids.add(event_id)
                        at = event.get("at")
                        try:
                            valid_time = isinstance(at, str) and datetime.fromisoformat(at).tzinfo is not None
                        except ValueError:
                            valid_time = False
                        if not valid_time:
                            errors.append(f"{event_id}.at 必须是带时区的日期时间")
            if field == "final_artifacts" and (not isinstance(item.get("path"), str) or not isinstance(item.get("sha256"), str)):
                errors.append(f"{identifier} 缺 path 或 sha256")
            if field == "authority_refs" and item.get("type") not in {"statute", "case"}:
                errors.append(f"{identifier}.type 必须是 statute 或 case")
            if field == "authority_refs":
                verification = item.get("verification")
                if not isinstance(verification, dict) or verification.get("status") not in {"verified", "partially_verified", "unverified"}:
                    errors.append(f"{identifier}.verification.status 无效")
                elif verification["status"] == "verified" and (not verification.get("source") or not verification.get("verified_at")):
                    errors.append(f"{identifier} 已核验状态缺来源或核验时间")
    return errors
