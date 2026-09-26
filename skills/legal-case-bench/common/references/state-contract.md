# 共同案件状态约定（State Schema v4）

`_case_state.json` 是案件的结构化事实与成果索引，与 `00-案件笔记.md` 互补：结构化数据不得替代案件笔记。

版本关系：

```text
Matter 托管案件（有 matter.yaml）  → State v4（含 matter_id）
存量旧案（无 matter.yaml）        → State v3，只读兼容；用 matter.py migrate 升级为 v4
```

## 顶层结构

```json
{
  "schema_version": 4,
  "matter_id": "UUID",
  "case_name": "案件名称",
  "case_tier": null,
  "facts": [],
  "issues": [],
  "pending_items": [],
  "reviews": [],
  "research_artifacts": [],
  "analysis_artifacts": [],
  "sequences": {"issue": 3, "pending_item": 0},
  "last_writer": {},
  "handoff_history": []
}
```

- `matter_id` 必须与 `matter.yaml` 的 `matter.id` 完全一致；写入前一律 hard stop 校验。
- `case_name` 是 compatibility mirror，权威名称仍是 `matter.yaml.matter.name`；不一致只告警，不自动覆盖。
- `case_tier` 保留兼容字段，权威来源为 `matter.yaml` 的 `governance.case_tier`。旧案保持 `null`，由用户选择后写入。
- `sequences` 是编号高水位，防止删除后回收编号；缺失按 0 处理。
- 未知顶层字段一律保留，不得在 round-trip 时删除。
- 4.0 增量字段 `proceedings[]`、`authority_refs[]`、`final_artifacts[]` 和 `sequences.proceeding/event/authority_ref/final_artifact` 均可选；缺失不触发迁移。字段契约见 `proceedings.md`、`authority-references.md`、`final-artifacts.md`。

## Matter 身份预检

所有状态写入口统一调用共享实现，禁止各脚本自行比较：

```text
resolve Matter Root → load matter.yaml → validate → load state
→ 校验 state.schema_version → 校验 state.matter_id == matter.id → 才允许写入
```

- 身份冲突 → `MatterIdConflict`，**hard stop**；不自动选择、不覆盖任一侧、不重建 Matter ID。
- `matter.yaml` 存在但缺 `_case_state.json` → `MatterStateMissing`（**Error**，非 warning）：Matter 结构不完整。
- `matter.yaml` 存在但 state 缺 `matter_id`（未迁移的 v3）→ 写入侧 `LegacyMatterNeedsMigration`，读取侧只记兼容性提示。
- `matter.yaml` 存在但自身无效 → 同样停止：身份无法确认就不写入。
- 没有 `matter.yaml` 的存量旧案不受影响：v3 仍可读写，也可随时用 `matter.py migrate` 升级为 v4。

**写入口清单（身份预检全覆盖）**：`state_update.commit` / `state_update.mutate`、
`issue.py`、`research_artifact.py`、`analysis_artifact.py`、`matter.py init`（唯一创建路径，写前断言）、
`upgrade_case_state.py`（Matter Root 与 v4+ state 一律拒绝）。
覆盖情况由开发仓的 `tests/audit-matter-identity-boundary.py` 以 8 入口 × 8 异常 = 64 组对抗矩阵验证（已安装副本与公开镜像不含 `tests/`）。

统一 mutation 入口是 `scripts/state_update.py` 的 `mutate()`（内部 snapshot → 只改目标字段 → `commit`）；
`commit()` 继续提供 workspace lock、SHA256 预检、stale 保护、`last_writer` 和原子写入。
禁止重建白名单对象后覆盖整个 state。

## 事实

事实条目使用稳定 `fact_id`，并区分：`party_statement`、`material_record`、`model_inference`、`legacy_unclassified`。每条事实须含原件定位和核验状态。旧事实不得删除或静默改写；修正时新增事实，并用 `supersedes` 建立关系。

新建 Matter 的事实编号使用 `FACT-0001` 形式；存量旧案的 `F-001` 保持可读。

## 争点（Issue 关系中心）

Issue 是 Matter 下的关系中心，稳定身份是 `issue_id`（标题可改）：

```json
{
  "issue_id": "ISS-0001",
  "title": "消费者购房人权利与建设工程价款优先权冲突",
  "status": "active",
  "category": "priority-conflict",
  "fact_refs": ["FACT-0001"],
  "research_refs": ["RA-0007"],
  "analysis_refs": ["AA-0003"],
  "current_position": {"summary": "", "confidence": "unknown"},
  "counterarguments": [],
  "evidence_gaps": [],
  "next_actions": [],
  "created_at": "...",
  "updated_at": "..."
}
```

- 编号规则：`ISS-\d{4,}`；不复用、不回收已删除编号；创建时取「当前最大编号」与「高水位」中的较大者加一。
- `title == issue_id` 被禁止，因为标题未来可以修改。
- 引用按前缀归属：`FACT-`/`F-` → `fact_refs`，`RA-`/`RES-` → `research_refs`，`AA-`/`ANA-` → `analysis_refs`。
  检索成果与专项分析**不得**被写成事实。
- 维护入口：`scripts/issue.py add|rename|link|list`。该入口只服务 State v4；旧 state 返回 `LegacyMatterNeedsMigration`。

校验分级：

```text
Error   ：issues 非数组、issue_id 缺失/格式非法/重复、title 与 issue_id 相同
Warning ：引用重复、引用目标尚未登记（dangling）
```

dangling 只告警：成果尚未登记不等于状态损坏。

## 待办

新建 Pending Item 使用标准结构，编号 `TASK-\d{4,}`：

```json
{"item_id": "TASK-0001", "title": "...", "issue_ref": "ISS-0001", "status": "open"}
```

仅结构化字段，不同步 Microsoft To Do，不接任何外部任务系统。

## 成果指针

`research_artifacts[]` 至少包含：`artifact_id`、`research_type`、`question`、`path`、`applicable_date`、`created_at`、`harness`、`sha256`、`verification_status`。

`analysis_artifacts[]` 至少包含：`artifact_id`、`title`、`input_artifacts`、`path`、`created_at`、`harness`、`sha256`、`status`。`input_artifacts` 中每项保存输入成果的 `artifact_id`、`artifact_kind` 和分析时使用的 `sha256`；不得只存路径。使用 `scripts/analysis_artifact.py check-stale --case-dir <案件目录>` 比对当前成果哈希，发现变化即把旧分析标记为需要复核。

成果指针不得复制报告正文。检索结果和专项分析均不是案件事实；需要转化为事实时，必须重新核对原件并另行入账。

成果的 `matter_id` / `issue_refs` 关联**尚未写入**（Artifact Matter-awareness 排在 3.3 / 3.4）。
当前成果条目不含 `matter_id`，`validate` 也不因此告警——这是刻意的：迁移只做结构升级，
不给历史成果补新字段。

## 状态域

案件状态、任务状态和文稿状态彼此独立。定稿不自动结案；结案依据用户指示或正式结案材料。
