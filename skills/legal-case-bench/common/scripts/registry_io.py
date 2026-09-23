#!/usr/bin/env python3
"""Registry / Index 的读写、条目匹配与 v1 → v2 形状构造。

Phase 3 的 `matter.py init` 与 Phase 4 的 migration 共用本模块，
避免出现两套 registry 形状逻辑（Phase 4 计划 §63）。

**权威性约定**（Gate 1 决定）：

```text
Registry v2
  ├── matters[]    ← authoritative，正式 Registry
  └── cases[]      ← legacy compatibility projection，由 matters 派生
```

读取方在 schema v2 下一律只信 `matters[]`；旧程序若仍读 `cases[]` 仅是兼容。
写入方只有一条逻辑：更新 `matters[]` → 派生 `cases[]`，不得把二者当两个源分别写。

本模块只做**形状与匹配**；事务、锁、备份、原子写由调用方负责。
"""

from __future__ import annotations

import copy
import datetime
import json
from pathlib import Path
from typing import Any, Sequence

from matter_io import MatterRegistryConflict, MigrationRegistryAmbiguous

REGISTRY_FILENAME = "_registry.json"
INDEX_FILENAME = "_INDEX.md"
SUPPORTED_REGISTRY_VERSION = 2


def today() -> str:
    return datetime.date.today().isoformat()


# --- 读取与识别 -----------------------------------------------------------


def load_registry(path: str | Path) -> dict[str, Any] | None:
    """读取 registry；不存在返回 None，结构非法抛 MatterRegistryConflict。"""

    target = Path(path)
    if not target.exists():
        return None
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise MatterRegistryConflict(f"无法读取登记表：{target}: {exc}") from exc
    if not isinstance(data, dict):
        raise MatterRegistryConflict(f"登记表必须是 JSON 对象：{target}")
    return data


def registry_version(registry: dict[str, Any] | None) -> int | None:
    """返回声明的 schema_version；legacy v1 没有该字段时返回 None。"""

    if not isinstance(registry, dict):
        return None
    version = registry.get("schema_version")
    if isinstance(version, bool) or not isinstance(version, int):
        return None
    return version


def is_v2(registry: dict[str, Any] | None) -> bool:
    return registry_version(registry) == SUPPORTED_REGISTRY_VERSION


# --- 条目匹配 -------------------------------------------------------------


def _entries(registry: dict[str, Any], key: str) -> list[dict[str, Any]]:
    items = registry.get(key)
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def match_entries(
    registry: dict[str, Any] | None,
    names: Sequence[str],
    case_dir: str | Path,
) -> list[tuple[str, dict[str, Any]]]:
    """按 product_dir 精确优先、其次 name 精确，返回所有候选 (来源, 条目)。

    §30：product_dir 精确匹配优先于 name；同名多个且无法唯一确定时由调用方 hard stop。
    `names` 是候选案件名（state.case_name、目录名等），因为旧登记表的 name 可能与
    state.case_name 不一致。
    """

    if not isinstance(registry, dict):
        return []
    candidates = {name for name in names if isinstance(name, str) and name}
    target = str(Path(case_dir).expanduser().resolve())
    v2 = is_v2(registry)
    matches: list[tuple[str, dict[str, Any]]] = []
    for key in (("matters", "cases") if v2 else ("cases",)):
        by_path: list[dict[str, Any]] = []
        by_name: list[dict[str, Any]] = []
        for item in _entries(registry, key):
            # v2 下 cases[] 只是 matters[] 的投影：带 matter_id 的镜像条目不得
            # 作为独立 entry 参与匹配，否则同一个案件会被匹配两次而误判为歧义。
            if v2 and key == "cases" and item.get("matter_id"):
                continue
            product_dir = item.get("product_dir")
            if isinstance(product_dir, str) and product_dir:
                if str(Path(product_dir).expanduser().resolve()) == target:
                    by_path.append(item)
                    continue
            if item.get("name") in candidates:
                by_name.append(item)
        matches.extend((f"{key}:product_dir", item) for item in by_path)
        matches.extend((f"{key}:name", item) for item in by_name)
    return matches


def resolve_entry(
    registry: dict[str, Any] | None,
    names: Sequence[str],
    case_dir: str | Path,
) -> tuple[dict[str, Any] | None, list[str]]:
    """定位唯一的目标条目；返回 (entry, warnings)。

    歧义时抛 MigrationRegistryAmbiguous（§30：不要猜）。
    """

    matches = match_entries(registry, names, case_dir)
    if not matches:
        return None, []
    by_path = [item for source, item in matches if source.endswith("product_dir")]
    if len(by_path) == 1:
        return by_path[0], []
    if len(by_path) > 1:
        raise MigrationRegistryAmbiguous(
            f"登记表中有 {len(by_path)} 个条目 product_dir 同时指向 {case_dir}；无法唯一确定，拒绝猜测"
        )
    by_name = [item for source, item in matches if source.endswith(":name")]
    unique: list[dict[str, Any]] = []
    for item in by_name:
        if item not in unique:
            unique.append(item)
    if len(unique) == 1:
        return unique[0], ["登记表按 name 匹配到条目（无 product_dir 精确匹配）；已记录所选条目"]
    raise MigrationRegistryAmbiguous(
        f"登记表中有 {len(unique)} 个同名条目且无 product_dir 精确匹配：{sorted(names)}；"
        "无法唯一确定，拒绝猜测"
    )


# --- v2 形状构造（init 与 migration 共用） --------------------------------


def build_matter_entry(
    *,
    matter_id: str,
    name: str,
    root: Path,
    matter_type: str,
    code: str = "",
    role: str = "unknown",
    procedure_stage: str = "unknown",
    status: str = "active",
    case_dir: str = "",
    drive: str = "",
    updated_at: str = "",
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "matter_id": matter_id,
        "name": name,
        "type": matter_type,
        "product_dir": str(Path(root) / name),
        "status": status,
        "updated_at": updated_at or today(),
        "role": role,
        "stage": procedure_stage,
    }
    if code:
        entry["code"] = code
    if case_dir:
        entry["case_dir"] = case_dir
    if drive:
        entry["kdocs_drive_id"] = drive
    return entry


def legacy_case_entry(entry: dict[str, Any], created_at: str) -> dict[str, Any]:
    """为旧读取器保留 cases 镜像，同时把 Matter ID 暴露出来。"""

    return {
        "name": entry["name"],
        "product_dir": entry["product_dir"],
        "case_dir": entry.get("case_dir", ""),
        "kdocs_drive_id": entry.get("kdocs_drive_id", ""),
        "status": entry["status"],
        "created_at": created_at,
        "updated_at": entry["updated_at"],
        "matter_id": entry["matter_id"],
    }


def upgrade_to_v2_shell(
    registry: dict[str, Any] | None,
    root: Path,
) -> dict[str, Any]:
    """把 v1（或空）登记表升为 v2 外壳；旧 cases 原样保留。"""

    if registry is None:
        return {
            "schema_version": SUPPORTED_REGISTRY_VERSION,
            "product_root": str(root),
            "matters": [],
            "updated_at": today(),
        }
    if not isinstance(registry, dict):
        raise MatterRegistryConflict(f"既有登记表不是 JSON 对象：{root / REGISTRY_FILENAME}")
    if is_v2(registry):
        if not isinstance(registry.get("matters"), list):
            raise MatterRegistryConflict("Registry v2 缺少有效 matters 列表")
        return copy.deepcopy(registry)
    if isinstance(registry.get("cases"), list):
        upgraded = copy.deepcopy(registry)
        upgraded["schema_version"] = SUPPORTED_REGISTRY_VERSION
        upgraded.setdefault("product_root", str(root))
        upgraded["matters"] = []
        upgraded["updated_at"] = today()
        return upgraded
    raise MatterRegistryConflict(f"无法兼容既有登记表：{root / REGISTRY_FILENAME}")


def upsert_matter_entry(
    registry: dict[str, Any],
    entry: dict[str, Any],
    created_at: str,
) -> None:
    """按 matter_id 幂等写入 v2 条目（§32）。

    写入逻辑只有一条：**先更新 `matters[]`（authority），再由它派生 `cases[]` 投影**。
    `cases` 不是第二个 Source of Truth，任何调用方都不得独立改它。
    """

    matters = registry.setdefault("matters", [])
    if not isinstance(matters, list):
        raise MatterRegistryConflict("Registry v2 的 matters 必须是列表")
    existing = next(
        (item for item in matters if isinstance(item, dict) and item.get("matter_id") == entry["matter_id"]),
        None,
    )
    if existing is None:
        matters.append(copy.deepcopy(entry))
    else:
        existing.clear()
        existing.update(copy.deepcopy(entry))

    sync_cases_mirror(registry, created_at)
    registry["updated_at"] = today()


def sync_cases_mirror(registry: dict[str, Any], created_at: str = "") -> None:
    """由 `matters[]` 派生 `cases[]` 兼容投影。

    读取规则：schema v2 只以 `matters[]` 为正式 Registry；`cases[]` 仅供仍读旧结构
    的程序兼容。二者冲突时**一律以 matters 为准**，因此不可能出现
    `matters.matter_id = AAA` 而 `cases.matter_id = BBB`。

    尚未迁入 matters 的旧条目原样保留，不因本函数被改写。
    """

    cases = registry.get("cases")
    if not isinstance(cases, list):
        return
    stamp = created_at or today()
    for entry in registry.get("matters") or []:
        if not isinstance(entry, dict) or not entry.get("matter_id"):
            continue
        mirror = next(
            (
                item
                for item in cases
                if isinstance(item, dict)
                and (
                    item.get("matter_id") == entry["matter_id"]
                    or item.get("name") == entry.get("name")
                    or item.get("product_dir") == entry.get("product_dir")
                )
            ),
            None,
        )
        if mirror is None:
            cases.append(legacy_case_entry(entry, stamp))
            continue
        # authority 覆盖：身份与关键字段以 matters 为准，其余旧字段保留。
        mirror["matter_id"] = entry["matter_id"]
        mirror["name"] = entry["name"]
        mirror["product_dir"] = entry["product_dir"]
        mirror["status"] = entry["status"]
        mirror["updated_at"] = entry["updated_at"]
        mirror.setdefault("created_at", stamp)


def matter_entry_present(registry: dict[str, Any] | None, matter_id: str) -> bool:
    if not isinstance(registry, dict):
        return False
    return any(
        isinstance(item, dict) and item.get("matter_id") == matter_id
        for item in _entries(registry, "matters")
    )


# --- Index ----------------------------------------------------------------


def index_row(entry: dict[str, Any]) -> str:
    short_id = str(entry["matter_id"]).split("-", 1)[0]
    return (
        f"| {short_id} | {entry['name']} | {entry['type']} | {entry.get('role', 'unknown')} | "
        f"{entry.get('stage', 'unknown')} | {entry['status']} | {entry['updated_at']} |\n"
    )


def update_index(text: str | None, entry: dict[str, Any]) -> str:
    """把 Matter 行写入人类可读索引（_INDEX.md 不是 Source of Truth）。"""

    if text is None:
        return (
            "# Matter 工作台总索引\n\n"
            "| Matter ID | 案件名 | 类型 | 角色 | 阶段 | 状态 | 更新日期 |\n"
            "|---|---|---|---|---|---|---|\n"
            + index_row(entry)
        )

    lines = text.splitlines(keepends=True)
    header = next((i for i, line in enumerate(lines) if line.startswith("| Matter ID |")), None)
    if header is not None and header + 1 < len(lines):
        short_id = str(entry["matter_id"]).split("-", 1)[0]
        row = index_row(entry)
        rows = [
            i
            for i in range(header + 2, len(lines))
            if lines[i].startswith("| ") and lines[i].split("|")[1].strip() == short_id
        ]
        if len(rows) > 1:
            raise MatterRegistryConflict(f"_INDEX.md 存在重复 Matter ID：{short_id}")
        if rows:
            lines[rows[0]] = row
        else:
            lines.insert(header + 2, row)
        return "".join(lines)

    suffix = "" if text.endswith("\n") else "\n"
    return (
        text
        + suffix
        + "\n## Matter Registry v2\n\n"
        + "| Matter ID | 案件名 | 类型 | 角色 | 阶段 | 状态 | 更新日期 |\n"
        + "|---|---|---|---|---|---|---|\n"
        + index_row(entry)
    )
