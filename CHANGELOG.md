# 版本记录（legal-case-bench）

> 本文件说明**每个已发布版本的含义**，不重写历史。
> 已发布版本不可改写（skillhub 规则）；版本号的历史就是项目的历史。
>
> **Current stable Matter Foundation: 3.2.8**

## 版本语义

```text
3.2.x   Matter Foundation（Matter Contract v1 / State v4 / Registry v2 / Legacy Migration）
3.3     Matter Module enrichment        （计划中）
3.4     Authority Layer                 （计划中）
```

## 3.2.8

Redact a real case name from shipped text

- 3.2.7 的词汇表说明、`matter_io.py` 注释与本 CHANGELOG 条目里，为了说明
  "为什么 `non-litigation` 需要 `debtor`"，把**真实案件名**写了进去。
  公开脱敏镜像随即把它带上了 GitHub。
- **漏点不在镜像生成，而在于公开向的文本本来就不该写案件名。**
  依赖发布时替换是错的：替换规则覆盖不了新写的散文，而案件名一旦推上去就收不回来。
- 三处均已改为不含案件名的表述（"在一宗非诉债务重组案件中我方是债务人"）。
- 新增 `tests/test_shipped_text_hygiene.py`：
  以**私有案件工作区的登记**为黑名单，扫描随包发布与进公开仓的文本；
  另有 `test_deny_list_covers_every_registered_matter` 保证新增案件时黑名单被补上，
  以免防线悄悄失效。已实测注入案件名会失败并报出文件与行号。
- 教训：`evals/evals.json` 里的案件名靠镜像生成时的替换处理，
  但**散文与注释不能依赖替换**——这类内容必须从源头就不写。


## 3.2.7

Role vocabulary corrected against a real case

- **`non-litigation` 的角色集原先过窄**。3.2.4 冻结词汇表时该 type 只允许
  `unknown` / `other`，理由是"非诉的代表身份尚未形成稳定分类"。真实案件否决了这个判断：
  在一宗非诉债务重组案件中我方是**债务人**，词表里没有可表达的值。
- 现改为：非诉沿用破产的**经济地位**角色 `debtor` / `creditor` / `investor` /
  `restructuring-advisor`，但**不含 `administrator`**——管理人是法院指定的职务，
  只在正式破产程序中有意义。
- 词汇表文档补上这一组的来源说明；新增 1 项测试
  （`test_non_litigation_party_roles_are_allowed_but_not_administrator`）锁定该规则。
- 教训记下：词汇表应先把已知的真实案件套一遍再冻结，否则"刻意的克制"
  会变成"表达不了"。


## 3.2.6

Ship the license with the artifact

- **许可文本现在随技能包一起分发**。此前 `skills/legal-case-bench/LICENSE` 只存在于
  仓库中，未进入发布载荷，四端安装副本都没有许可文本。
- MIT 明文要求 *"The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software."*——
  安装到各端就是制作副本，因此这不只是整洁问题，而是许可条款要求。
  `manifest.json` 的 `includes` 增加 `skills/legal-case-bench/LICENSE → LICENSE`，
  安装后位于技能根目录，与公开仓的 `skills/legal-case-bench/LICENSE` 对应。
- 仅新增一个文件，不改变任何行为。


## 3.2.5

Same cleanup, second sweep: user-visible strings and remaining references

3.2.4 清掉 reference 文档里的过期阶段描述后，全仓复查又发现**同一类**残留，
其中一处会直接误导使用者：

- **`matter.py migrate --help` 曾写着「正式写入（Phase 4C 交付前一律拒绝）」** ——
  但 `--apply` 早已可用。照帮助读会以为功能尚未交付。已改为
  「正式写入；不带此参数为 dry-run，不写任何文件」。
- dry-run 输出的结尾语同样去掉「（Phase 4C 交付）」。
- `matter_io.py` 的错误信息「State v3 → v4 迁移属 Phase 4，本阶段不自动升级」
  改为「需显式迁移（matter.py migrate）」——原文暗示迁移尚未提供。
- `matter-contract.md` 两处：「旧案迁移属 Phase 4」→「需显式执行 matter.py migrate」；
  「Phase 3 已落地」→「已落地」。
- `state_update.py`、`state_migration.py`、`issue.py`、`matter-migration.md`
  中的「属 Phase 5 / Phase 4 migration 之前」等未来式，统一改为版本路线图措辞
  （3.3 / 3.4）或直接陈述当前做法。

**保留未改**：各模块 docstring 中对「Phase 4A/4B/4C 计划 §NN」的引用属于**设计出处**，
不陈述当前状态，作为代码来源的追溯保留。

本版只改文案与文档，不改变任何行为；232 项测试全绿，六个正式案件仍全部 `valid`。


## 3.2.4

Contract cleanup: current-state references + frozen role vocabulary

只做 Contract / 文档正确性，**不碰 migration 架构**。

- **清理过期阶段描述**。`matter-contract.md`、`state-contract.md`、`matter-resolution.md`
  仍在用 Phase 3 preview / "Phase 4 才迁移" / "State v4 阶段才会…" 这类未来式措辞，
  与实际能力（migration 已完成、正式案件 rollout 已完成）自相矛盾。
  这些 reference 是 `SKILL.md` 要求 Agent 每次启动必读的文件，属于 **runtime context**，
  过期描述会直接进入模型上下文，因此按 P1 处理。
- **`core-workflow.md` 补 Matter-first 开工流程**。原文仍是 2.x 目录模型、缺 `matter.yaml`；
  现在给出 Resolve Matter → load `matter.yaml` → validate `matter_id` → load state → load notes
  → 执行任务 的固定顺序，并写明不得靠目录名 / Registry 名称推断 Matter。
- **冻结 `engagement.role` 规范词汇**。新增 `references/matter-vocabulary.md`；
  `role` 与 `type` 的约束在**写入侧硬校验**：
  `type: litigation` + `role: administrator` 这类错配会被 `matter.py validate` 拦下，
  自由写法（`admin` / `manager` / `管理人`）一律拒绝。
  理由：下游的 Perspective Match 按 token 精确匹配，同义并存会让匹配**静默失效**。
- **`matter.schema.json` 的 `role` 由自由字符串改为规范枚举**（14 个 token），
  并加测试锁定 schema 与 `matter_io.py` 常量逐字一致，防止两处各自漂移。
- **明确测试命令的适用范围**。`matter-migration.md` 原先直接给出 `tests/…` 命令，
  但已安装副本与公开脱敏镜像都不含 `tests/`。现在写明这些命令只在开发仓可用。
- 修正 `matter_io.py` 中一处 Phase 4 过期注释（v3 兼容说明）。

新增 6 项测试（`MatterVocabularyTest`）。六个正式案件收紧后仍全部 `valid`、0 warnings
（它们的 `role: unknown` 是合法兜底值）。


## 3.2.3

Snapshot timestamp parsing made version-independent

- 修复 3.2.2 自身的脆弱点：`datetime.fromisoformat` 解析 `Z` 结尾与 `+0800`（无冒号）
  是 **Python 3.11 才支持**的。3.9/3.10 上这两种写法抛 `ValueError`，被兜底逻辑接住后
  **原样落进目录名**，导致同一时刻在不同 Python 版本上得到不同快照名——
  正是 3.2.2 要消除的"同一时刻不同名字"。
- 改为**先归一化再解析**：`Z`/`z` → `+00:00`，`±HHMM` → `±HH:MM`，行为与 Python 版本无关。
- 兜底由"原样返回"改为**直接报错**：静默写出一个含义可疑的目录名，正是 3.2.2 修掉的那类问题。
  占位符 `<apply-time>` 仍原样返回，保住 dry-run 的可重复性。
- **生产迁移路径不受影响**：运行时 stamp 来自
  `now().astimezone().isoformat(timespec="seconds")`，永远带冒号，3.9 也能正确解析。
  本版是稳健性修复，不改变任何既有快照或数据。

## 3.2.2

Snapshot timestamp naming correctness fix

- 快照目录名的时间戳改用 **UTC**（`matter-v1-<UTC-timestamp>-<fingerprint>`）。
- 修复 3.2.1 及更早的缺陷：`.replace("+", "-")` 把本机 `+0800` 写成 `-0800`，
  而 `-0800` 在 ISO-8601 里表示 UTC−8，**与真实偏移相差 16 小时**。
  这种"看起来完全合法、含义却相反"的 metadata 会误导读目录名判断快照时间的运维人员；
  且同一套命名在 UTC−8 机器上反而是对的，**跨时区语义不一致**。
- **已产生的旧快照一律不改名**（journal 按绝对路径引用，改名会切断 journal↔snapshot 链路），
  因此 `.migration/` 下允许两种命名并存。恢复演练脚本原先按目录名排序取最早快照，
  已改为按 manifest 的 `created_at`——字典序不再等于时间序。
- 权威时间不受影响：`manifest.created_at` 与 journal `started_at` 始终保留本地偏移的
  ISO-8601 忠实写法。
- 不影响数据与恢复正确性（本修复只改目录名标签），正式案件工作区零改动。

## 3.2.1

Migration / rollout stabilization

- 修复 dry-run 预告的快照目录与实际创建不一致（时间戳格式与案件指纹都不同），
  运维照 dry-run 去找会扑空。抽出共享的 `snapshot_dirname()`，
  由 `stamp_plan_time()` 在 apply 时解析为**实际会创建**的路径。

## 3.2.0

Matter Foundation migration infrastructure

- Matter Contract v1（`matter.yaml`）、Case State v4、Registry v2 与 Legacy Migration 完整交付。
- 事务化迁移：锁 → 哈希预检 → 备份 → 二次预检 → 身份解析 → 四步写入 → 后校验。
- 可恢复：journal + snapshot manifest + `--apply` 幂等；完整恢复演练通过。
- 见 `docs/MIGRATION-3.0.md`（使用者）与 `common/references/matter-migration.md`（Agent/开发者）。

## 3.1.2

Phase 3 preview / internal（Gate 1 审计轮次）

## 3.1.1

Phase 3 preview / internal

- Case State v4 落地；本版为内部预览版，`--apply` 尚未开放。

## 3.1.0

Phase 3 preview / internal

## 3.0.0

Initial Matter Architecture release

- Matter Architecture 首次发布（Phase 1/2）。本版已发布且不可改写；
  其后的 Matter Foundation 完整版落在 **3.2.0**，不在 3.0.0 上重发。

## 2.4.0 – 2.7.0

共同案件工作台（CaseBench 2.x）系列。

- 案件工作台：建案、案件笔记、材料读取、检索成果落盘、复核、版本与定稿。
- 状态结构为 `_case_state.json` **schema v2/v3**；无 `matter.yaml`、无 Matter 身份。
- 这些版本建立的案件即 3.2.x 迁移的 legacy 来源（`schema_version: 3`）。
