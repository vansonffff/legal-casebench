# 版本记录（legal-case-bench）

> 本文件说明**每个已发布版本的含义**，不重写历史。
> 已发布版本不可改写（skillhub 规则）；版本号的历史就是项目的历史。
>
> **Current stable Matter Foundation: 3.2.8**
> **Current development route: CaseBench 4.0**

## 版本语义

```text
3.2.x   Matter Foundation（Matter Contract v1 / State v4 / Registry v2 / Legacy Migration；当前稳定线）
4.0     CaseBench Core + DSH 案件工作台（当前开发路线）
```

原 3.3 Matter Module enrichment 与 3.4 Authority Layer 仅保留为历史路线记录，不再单独作为当前开发线。Authority 能力并入 4.0；Matter Module enrichment 暂缓，不阻塞 4.0。详见 [docs/CASEBENCH-4.0-PLAN.md](docs/CASEBENCH-4.0-PLAN.md)。

## 4.0.0-rc.1 · 真实案件验证候选

- 代码与 beta.2 相同；本版标注表示 Phase 10 真实案件验证通过：某真实系列 Matter（17 个 Proceeding、8 条已核验法条、1 项定稿）在真实 profile 浏览器实测展示正确，另有两条经真实对话沉淀的 Practice Note。
- 新增 `probe-series.mjs` 系列案件 UI 回归探针（真实案件名经环境变量传入，不入库）。
- 隔离环境完成 beta.2 → rc.1 插件升级与双次冷启动回归；desktop 端修复 Electron PATH 导致的 Python 查找失败后用户确认正常。
- 系列详情全量铺开的折叠、系列 Matter 阶段显示、开庭事件真实覆盖为已知观察项，详见 [RC 验证记录](docs/CASEBENCH-4.0-RC1.md)。

## 4.0.0-beta.2 · 工作流贯通与发布漂移修复

- 修复 beta.1 发布滞留：共同源在打包后继续演进的经验复用能力（`prepare-reuse` 问题卡、`list --query` 检索、`promote --authority-ref`、final_artifacts 引用核验及对应门控文档）未进入注册包，四端安装与 DSH Bundle 均缺该能力；本版正式发布到四端与 Bundle。
- 新增 `tests/test_release_drift.py` 漂移防线：版本已在 registry 存在时共同源必须与不可变包字节一致，开发下一版须先提升版本号；修复前该测试准确失败并列出漂移文件。
- 完成计划 Phase 8 三场景端到端演练（隔离工作区 + DSH 安装副本复跑），含两次真实元典联网核验；行为层「仅提示」门控以负向对照验证，真实对话形态留待 RC。详见 [工作流演练记录](docs/CASEBENCH-4.0-beta.2-WORKFLOW.md)。
- DSH 插件同步升至 4.0.0-beta.2（仅组装内容与版本变化，宿主/客户端代码未改，无需重启 Host）。255 项 Python 测试、3 项插件测试、validate/diff/doctor 全部通过；未推送公开仓库。

## DSH Plugin 4.0.0-beta.1.2 · 中文界面

- 角色、阶段、关联案件状态、成果类型、依据类型与核验状态使用中文标签，未知英文代码显示中文待确认提示。
- 设置页、入口说明、经验复用提示及界面错误提示中文化，日期时间使用可读格式。
- 真实浏览器检查六个案件详情、十八个成果/依据页面、两个经验详情和设置页，无英文系统术语残留或页面错误。Core 及案件数据不变。详见 [中文界面验收](docs/CASEBENCH-DSH-beta.1.2-ZH.md)。

## DSH Plugin 4.0.0-beta.1.1 · 交互修复

- 修复同一来源 Matter 的 Practice Note React key 冲突及两标签列表残留。
- “打开”改用真实 DSH `useTabInfo()`、session 文件地址；程序阶段占位值显示为“阶段待确认”。
- 真实浏览器完成四轮标签切换、Markdown 正文与重复打开、Word 原生 PDF 预览回归；已更新本地插件并重启 Host。Core / Skillhub 版本仍为 beta.1，真实办案数据未改。详见 [修复记录](docs/CASEBENCH-DSH-beta.1.1-FIX.md)。

## 4.0.0-beta.1 · 本地预发布

- CaseBench Core 在 State v4 中增量支持 Proceeding、Event、Authority Reference、Final Artifact；旧 Matter 保持只读兼容，不自动迁移。
- 新增经用户确认后才可沉淀的 `_practice/` Authority 和 Practice Note，以及供各端共享的只读 JSON Read Model。
- 新增 DSH Plugin：Cordis Host、Typert Remote、Settings 和右侧栏“案件工作台”；案件和办案经验可浏览，Matter 数据仍以 Core 工作区为准。
- Skillhub 增加预发布版本解析，未指定版本时仍优先选择稳定版；只发布 CaseBench 的本地不可变包，并将四端受管安装更新到本版。DSH `web` Profile 通过正式 CLI 指向持久源码目录。
- 252 项共同源回归测试、3 项插件测试、Skillhub doctor、真实 DSH Host/Client 和浏览器页面挂载均通过；6 个既有 Matter 完成只读读取。验收明细与剩余范围见 [docs/CASEBENCH-4.0-ACCEPTANCE.md](docs/CASEBENCH-4.0-ACCEPTANCE.md)。
- 本版尚未达到 4.0 RC：真实案件的写入闭环、办案经验复用交互及系列案件情境仍需专项验收；没有推送公开仓库或发布 npm 包。

## Unreleased · CaseBench 4.0 Phase 0 文档冻结

- 将 3.2.8 标明为当前稳定基线，将 4.0 标明为当前开发路线。
- 冻结 Matter Contract v1、State v4、Registry v2 的兼容边界；新增字段采用可选、增量演进，不要求批量迁移旧 Matter。
- 新增 4.0 整体计划与 Phase 0 契约冻结文档。
- 本条记录的是计划和契约文档变更，不表示 4.0 运行功能已经实现，也不构成版本发布。

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
  理由：下游 DSH 的 Perspective Match 按 token 精确匹配，同义并存会让匹配**静默失效**。
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

- 快照目录名的时间戳改用 **UTC**（`matter-v1-2026-09-18T231833Z-<指纹>`）。
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
