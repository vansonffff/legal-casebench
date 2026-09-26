#!/usr/bin/env python3
"""以增量方式预览或升级 bench.config.json 到 v3。"""

from __future__ import annotations

import argparse
import datetime
import json
import shutil
from pathlib import Path

from workspace_io import atomic_write, dump_json_bytes, file_digest, load_json, workspace_lock


def upgraded(original: dict) -> dict:
    result = dict(original)
    result["schema"] = "legal-case-bench/config"
    result["version"] = 3
    result.setdefault("case_tiers", {
        "selection": "user_only",
        "values": ["routine", "complex", "critical"],
        "default": None,
    })
    result.setdefault("knowledge_sources", {})
    result["knowledge_sources"].setdefault("ima", {
        "mcp_server": "ima",
        "order": 1,
        "purpose": "个人知识材料与既有研究线索",
        "required_attempt": True,
        "on_unavailable": "record_not_available_and_continue",
        "not_authoritative_for": ["法条效力", "案例身份", "裁判全文"],
    })
    result.setdefault("harnesses", {})
    result["harnesses"].setdefault("workbuddy", {
        "role": "轻量入口，可独立办结",
        "model_selection": "user_selected",
    })
    result["harnesses"].setdefault("myagents", {
        "role": "复杂案件与可定制团队协作",
        "model_selection": "user_selected",
    })
    result["harnesses"].setdefault("codex", {
        "role": "疑难法律分析专家室",
        "default_subagents": False,
        "writes": ["analysis_artifacts", "research_artifacts_when_needed"],
        "does_not_directly_rewrite": ["facts", "decided_issues", "user_positions"],
    })
    result["harnesses"].setdefault("dsh", {
        "role": "DSH 工作台入口，可独立办结",
        "model_selection": "user_selected",
        "default_subagents": False,
    })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--path", default=str(Path.home() / "Documents" / "My Legal-agents" / "bench.config.json"))
    args = parser.parse_args()
    path = Path(args.path).resolve()
    original = load_json(path, {})
    result = upgraded(original)
    response = {"path": str(path), "changed": result != original, "applied": False, "backup": None}
    if args.apply and response["changed"]:
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(path.name + f".bak.{stamp}")
        with workspace_lock(path.parent):
            baseline = file_digest(path)
            shutil.copy2(path, backup)
            atomic_write(path, dump_json_bytes(result), baseline)
        response.update({"applied": True, "backup": str(backup)})
    print(json.dumps(response, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
