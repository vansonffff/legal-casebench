#!/usr/bin/env python3
"""State v3 → v4 的纯变换（Phase 4B 冻结）。

## 冻结契约

本模块的所有公开函数都是**纯函数**，冻结如下：

```text
migrate_state_v3_to_v4(state, *, matter_id=None) -> StateTransformResult
assign_issue_ids(issues, *, high_water=0)        -> (new_issues, changes, warnings)
assign_pending_item_ids(items, *, high_water=0)  -> (new_items, changes, warnings)
normalize_legacy_issue(issue)                    -> (new_issue, changes, warnings)
derive_sequences(issues, items, *, current=None) -> (new_sequences, changes)
```

每一项都必须满足：

```text
pure function      无副作用
input immutable    绝不修改入参（含入参内部的 dict / list）
output new object  返回值与入参不共享可变引用
deterministic      同一输入必得同一输出
no filesystem      不读盘不写盘
no clock           不取当前时间
no uuid            不生成任何 ID
```

因此：**Matter ID、时间戳、last_writer、backup 路径、registry 写入一律不进本模块**。
它们由 orchestration 层（`matter_migration.py`）与事务层（Phase 4C）负责。
上述契约由 `tests/test_state_migration.py` 以行为测试 + 源码扫描强制。

## 数据约束（Phase 4 计划 §18–§25）

- 绝不重建"白名单对象"：只 patch 明确授权的字段，未识别字段一律保留；
- `facts` 零重写（不重编号、不重分类、不补 matter_id、不清洗）；
- `research_artifacts` / `analysis_artifacts` 零重写（Matter-aware 排在 3.3 / 3.4）；
- Issue 按**原数组顺序**稳定分配 `ISS-NNNN`，已有合法 ID 不动；
- 非法 `issue_id` 移入 `legacy_issue_id`，不丢数据；
- `sequences` 取历史最大值，只增不减；
- 不推断案件类型、角色、程序阶段。
"""

from __future__ import annotations

import copy
from typing import Any, Sequence

from matter_io import (
    ISSUE_ID_PATTERN,
    PENDING_ITEM_ID_PATTERN,
    STATE_SCHEMA_VERSION,
    MatterInvalid,
    recorded_sequence,
)

# §22：legacy Issue 缺失时可补的 schema default。
# title 不在此列——它由 normalize_legacy_issue() 从 question/issue 逐字回退。
ISSUE_DEFAULTS: dict[str, Any] = {
    "status": "active",
    "category": None,
    "fact_refs": [],
    "research_refs": [],
    "analysis_refs": [],
    "current_position": {"summary": "", "confidence": "unknown"},
    "counterarguments": [],
    "evidence_gaps": [],
    "next_actions": [],
}

LEGACY_ISSUE_ID_KEY = "legacy_issue_id"


class StateTransformResult:
    """迁移结果：目标 state（新对象）+ 变更清单 + 警告。"""

    def __init__(self, state: dict[str, Any], changes: list[dict[str, Any]], warnings: list[str]) -> None:
        self.state = state
        self.changes = changes
        self.warnings = warnings

    @property
    def changed(self) -> bool:
        return bool(self.changes)


def _issue_number(value: Any) -> int | None:
    if isinstance(value, str) and ISSUE_ID_PATTERN.fullmatch(value):
        return int(value.rsplit("-", 1)[1])
    return None


def _pending_number(value: Any) -> int | None:
    if isinstance(value, str) and PENDING_ITEM_ID_PATTERN.fullmatch(value):
        return int(value.rsplit("-", 1)[1])
    return None


# --- 独立步骤（可单独调用、可单独测试） -----------------------------------


def normalize_legacy_issue(issue: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """补齐 legacy Issue 的 `title` 与 schema default；返回新对象。

    `title` 回退规则（Gate 1 决定）——**只做逐字复制，不改写、不概括、不推断**：

    ```text
    已有非空 title      → 保留
    否则非空 question   → title = question 原文
    否则非空 issue      → title = issue 原文
    否则                → 不生成 title，告警
    ```

    `question` / `issue` 原字段一律保留。入参不被修改。
    """

    if not isinstance(issue, dict):
        raise MatterInvalid("legacy issue 必须是对象")
    result = copy.deepcopy(issue)
    changes: list[dict[str, Any]] = []
    warnings: list[str] = []

    existing = result.get("title")
    if not (isinstance(existing, str) and existing.strip()):
        for source in ("question", "issue"):
            value = result.get(source)
            if isinstance(value, str) and value.strip():
                result["title"] = value  # verbatim，不做任何改写
                changes.append({"field": "title", "from": None, "to": value, "source": source})
                break
        else:
            warnings.append("缺少 title，且 question/issue 均为空；迁移不推断标题")

    for field, default in ISSUE_DEFAULTS.items():
        if field not in result:
            result[field] = copy.deepcopy(default)
            changes.append({"field": field, "to": copy.deepcopy(default)})
    return result, changes, warnings


def assign_issue_ids(
    issues: Sequence[Any],
    *,
    high_water: int = 0,
) -> tuple[list[Any], list[dict[str, Any]], list[str]]:
    """按**原数组顺序**为缺少或非法 `issue_id` 的条目分配 `ISS-NNNN`。

    规则（Gate 1 批准）：

    ```text
    next = max(所有合法历史 ISS 编号, high_water) + 1
    合法 issue_id   → 原样保留，不重新编号
    非法 issue_id   → 移入 legacy_issue_id，另分配合法编号
    无 issue_id     → 直接分配
    全案无合法 ID   → 从 ISS-0001 开始
    ```

    即序号是 **monotonic sequence，不是 compact index**：删除过的编号不复用。
    返回 (新列表, 变更, 警告)；入参与其内部的 dict 都不被修改。
    """

    records = list(issues or [])
    changes: list[dict[str, Any]] = []
    warnings: list[str] = []

    highest = max(0, high_water if isinstance(high_water, int) and not isinstance(high_water, bool) else 0)
    for index, issue in enumerate(records):
        if not isinstance(issue, dict):
            continue
        number = _issue_number(issue.get("issue_id"))
        if number is not None:
            highest = max(highest, number)
        elif "issue_id" in issue:
            warnings.append(
                f"issues[{index}].issue_id 格式非法（{issue.get('issue_id')!r}）；"
                f"将另行分配合法编号，原值保留在 {LEGACY_ISSUE_ID_KEY}"
            )

    result: list[Any] = []
    for index, issue in enumerate(records):
        if not isinstance(issue, dict):
            warnings.append(f"issues[{index}] 不是对象；原样保留，未做标准化")
            result.append(copy.deepcopy(issue))
            continue
        updated = copy.deepcopy(issue)
        if _issue_number(updated.get("issue_id")) is None:
            if "issue_id" in updated and LEGACY_ISSUE_ID_KEY not in updated:
                updated[LEGACY_ISSUE_ID_KEY] = updated["issue_id"]
            highest += 1
            allocated = f"ISS-{highest:04d}"
            changes.append(
                {"field": f"issues[{index}].issue_id", "from": updated.get("issue_id"), "to": allocated}
            )
            updated["issue_id"] = allocated
        result.append(updated)
    return result, changes, warnings


def assign_pending_item_ids(
    items: Sequence[Any],
    *,
    high_water: int = 0,
) -> tuple[list[Any], list[dict[str, Any]], list[str]]:
    """按原数组顺序为缺少 `item_id` 的待办分配 `TASK-NNNN`。

    已有合法编号原样保留；不连接任何外部任务系统。
    返回 (新列表, 变更, 警告)；入参不被修改。
    """

    records = list(items or [])
    changes: list[dict[str, Any]] = []
    warnings: list[str] = []

    highest = max(0, high_water if isinstance(high_water, int) and not isinstance(high_water, bool) else 0)
    for item in records:
        if isinstance(item, dict):
            number = _pending_number(item.get("item_id"))
            if number is not None:
                highest = max(highest, number)

    result: list[Any] = []
    for index, item in enumerate(records):
        if not isinstance(item, dict):
            warnings.append(f"pending_items[{index}] 不是对象；原样保留，未做标准化")
            result.append(copy.deepcopy(item))
            continue
        updated = copy.deepcopy(item)
        if _pending_number(updated.get("item_id")) is None:
            highest += 1
            allocated = f"TASK-{highest:04d}"
            changes.append(
                {"field": f"pending_items[{index}].item_id", "from": updated.get("item_id"), "to": allocated}
            )
            updated["item_id"] = allocated
        result.append(updated)
    return result, changes, warnings


def derive_sequences(
    issues: Sequence[Any],
    items: Sequence[Any],
    *,
    current: Any = None,
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    """由既有编号推导 `sequences` 高水位；**只增不减**（§24 / §25）。

    `current` 中更高的旧值会被保留，保证不会因为删除了编号而回退。
    """

    issue_max = 0
    for issue in issues or []:
        if isinstance(issue, dict):
            issue_max = max(issue_max, _issue_number(issue.get("issue_id")) or 0)
    pending_max = 0
    for item in items or []:
        if isinstance(item, dict):
            pending_max = max(pending_max, _pending_number(item.get("item_id")) or 0)

    previous = current if isinstance(current, dict) else {}
    result = copy.deepcopy(previous)
    changes: list[dict[str, Any]] = []
    for key, value in (("issue", issue_max), ("pending_item", pending_max)):
        recorded = previous.get(key)
        if isinstance(recorded, int) and not isinstance(recorded, bool) and recorded > value:
            value = recorded
        if recorded != value:
            result[key] = value
            changes.append({"field": f"sequences.{key}", "from": recorded, "to": value})
    return result, changes


# --- 顶层编排 -------------------------------------------------------------


def migrate_state_v3_to_v4(
    state: dict[str, Any],
    *,
    matter_id: str | None = None,
) -> StateTransformResult:
    """把 v3 state 转换为 v4；`matter_id=None` 表示身份尚未生成（dry-run）。

    除清单列出的变更外，原内容逐字段保留。**入参不被修改**，
    返回值是与入参不共享可变引用的新对象。

    本函数不设置 `last_writer`、不取时间、不生成 UUID——那些属于 orchestration / 事务层。
    """

    if not isinstance(state, dict):
        raise MatterInvalid("案件状态必须是 JSON 对象")
    version = state.get("schema_version")
    if version != 3:
        raise MatterInvalid(f"只支持 State v3 → v4；当前 schema_version={version!r}")

    result = copy.deepcopy(state)
    changes: list[dict[str, Any]] = []
    warnings: list[str] = []

    result["schema_version"] = STATE_SCHEMA_VERSION
    changes.append({"field": "schema_version", "from": 3, "to": STATE_SCHEMA_VERSION})

    if matter_id is not None:
        previous = result.get("matter_id")
        if previous is not None and previous != matter_id:
            raise MatterInvalid(f"目标 matter_id 与既有 matter_id 冲突：{previous} → {matter_id}")
        result["matter_id"] = matter_id
        changes.append({"field": "matter_id", "from": previous, "to": matter_id})

    raw_issues = result.get("issues")
    if raw_issues is None:
        raw_issues = []
    elif not isinstance(raw_issues, list):
        raise MatterInvalid("legacy state 的 issues 必须是数组")

    raw_items = result.get("pending_items")
    if raw_items is None:
        raw_items = []
    elif not isinstance(raw_items, list):
        raise MatterInvalid("legacy state 的 pending_items 必须是数组")

    issues, issue_changes, issue_warnings = assign_issue_ids(
        raw_issues, high_water=recorded_sequence(state, "issue")
    )
    changes.extend(issue_changes)
    warnings.extend(issue_warnings)

    normalized: list[Any] = []
    for index, issue in enumerate(issues):
        if not isinstance(issue, dict):
            normalized.append(issue)
            continue
        updated, step_changes, step_warnings = normalize_legacy_issue(issue)
        changes.extend({"field": f"issues[{index}].{item['field']}", **_rest(item)} for item in step_changes)
        warnings.extend(f"issues[{index}]：{item}" for item in step_warnings)
        normalized.append(updated)
    result["issues"] = normalized

    items, item_changes, item_warnings = assign_pending_item_ids(
        raw_items, high_water=recorded_sequence(state, "pending_item")
    )
    changes.extend(item_changes)
    warnings.extend(item_warnings)
    result["pending_items"] = items

    sequences, sequence_changes = derive_sequences(normalized, items, current=state.get("sequences"))
    result["sequences"] = sequences
    changes.extend(sequence_changes)

    return StateTransformResult(result, changes, warnings)


def _rest(change: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in change.items() if key != "field"}
