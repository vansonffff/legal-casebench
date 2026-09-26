# CaseBench 4.0 整体升级计划

> **状态：Phase 0 范围与设计契约文档。** 本文定义实现路线；当前 beta 的完成项和验收缺口另见 [CASEBENCH-4.0-ACCEPTANCE.md](CASEBENCH-4.0-ACCEPTANCE.md)。
> 当前稳定基线为 **3.2.8**。Matter Contract v1、State v4、Registry v2 继续作为兼容契约。

## 1. 版本定位

3.2.8 已提供跨 WorkBuddy、My Agents、Codex、DSH 共用的 CaseBench Core，包括 Matter 身份、稳定 Matter ID、State v4、Registry v2、Issue 引用、Research / Analysis Artifact、Review 和 Legacy Migration。

4.0 在保留跨 Agent Core 的基础上，增加 Matter 下的程序案件与本案法律依据结构，并建立经用户确认的 Practice Library；同时为 DSH 提供原生只读“案件工作台”。DSH 是 Core 的集成入口，不是案件事实源。

原路线中的 3.3 Matter Module enrichment 暂缓，不阻塞 4.0；原 3.4 Authority Layer 纳入 4.0，不再作为单独开发线。版本背景见 [CHANGELOG.md](../CHANGELOG.md)。

## 2. 核心原则

1. **文件仍是事实源。** `_registry.json`、`matter.yaml`、`_case_state.json`、案件笔记、Artifact manifests、`02-定稿/` 与 `_practice/` 承载数据。DSH Plugin 只保存必要的界面配置，不另建案件数据库。
2. **界面用于查看，自然语言用于办案。** 案件工作台原则上只读，不提供事实、争点、当事人、法律依据或任务的直接编辑表单。
3. **保留跨 Agent Core。** DSH UI、Cordis、Sidebar 和 Settings 代码进入 DSH Integration，不塞入 Core Skill。
4. **经验由用户决定是否沉淀。** Agent 可以提出建议；只有用户确认后才创建 Practice Note。
5. **历史经验不是当前法律依据。** 在新 Matter 中使用历史法条或案例前，重新核验真实性、效力、案号、裁判来源、事实可比性及当前适用性。无法联网核验时只能作为研究线索。
6. **兼容地增加字段。** 3.2.8 Matter 不要求批量迁移；新字段为可选项，读取方保留未知字段。所有 State 写入继续经过身份预检和统一 mutation/commit 路径。

## 3. 冻结的既有契约与新增边界

| 契约 | 4.0 约定 |
|---|---|
| Matter Contract | 保持 v1；Matter ID 仍是稳定身份，不改名、不重建，不由 DSH Workspace 身份替代。 |
| Case State | 保持 schema v4；以可选字段增量演进，不通过 4.0 功能自动迁移旧状态。 |
| Registry | 保持 v2；`matters[]` 仍是权威，`cases[]` 仍是兼容投影。 |
| Proceeding | 在 Matter 内表示具有独立程序身份或案件位置的程序案件；详见 [Phase 0 契约冻结](CASEBENCH-4.0-CONTRACTS.md#1-proceedings-contract-v1)。 |
| Authority Reference | 在 Matter 内记录本案使用的法条或案例及核验信息；详见 [Phase 0 契约冻结](CASEBENCH-4.0-CONTRACTS.md#2-authority-reference-contract-v1)。 |
| Practice Library | 在工作区级 `_practice/` 沉淀经用户确认的 Authority 与 Practice Note；详见 [Phase 0 契约冻结](CASEBENCH-4.0-CONTRACTS.md#3-practice-library-contract-v1)。 |
| 定稿成果 | 以可选 `final_artifacts[]` 结构化登记；既有 `02-定稿/` 保持原样，旧 Matter 可只读扫描展示，不反写 State。 |
| UI 中文名 | 冻结为“案件工作台”；英文项目名继续使用 CaseBench。 |

State v4 增加的顶层数据均为可选：`proceedings[]`、`authority_refs[]`、`final_artifacts[]`。`sequences` 在保留 `issue`、`pending_item` 的基础上增加 `proceeding`、`event`、`authority_ref`、`final_artifact` 高水位；旧 State 缺少新字段时仍须可读。未知字段在读取和写入 round-trip 中完整保留。

### 3.1 Matter 与 Proceeding

Matter 表示律师持续处理的一项完整法律事务。Proceeding 表示其下具有独立程序身份、案号或诉讼位置的具体案件；一个 Matter 可以没有 Proceeding、只有一个，或包含多个。4.0 首版不记录 Proceeding 之间的 `appeal_of`、`related_to`、`enforcement_of` 等关系。

普通单案不向用户暴露 Proceeding 技术概念；系列 Matter 展示其多个程序案件。缺少新字段的 3.2.8 Matter 仍然合法。

### 3.2 本案 Authority 与 Practice Authority

`authority_refs[]` 是单个 Matter 对法条或案例的引用及本案核验信息。`_practice/authorities/` 是跨 Matter 复用的外部依据登记；两者用途不同，不因显示相同而合并成一份数据。

Practice Authority 回答“外部依据是什么”；Practice Note 回答“办过相关案件后形成了什么可复用认识”。不确定是否重复时允许并存；第一版只做明确的精确规范化，不做 AI 模糊合并。

## 4. CaseBench Core 与 DSH Integration

### CaseBench Core

- 可选的 `proceedings[]`、`authority_refs[]`、`final_artifacts[]` 与工作区级 `_practice/` 数据结构。
- 通过统一写入口维护新字段，保持 Matter ID hard stop、并发 stale 检查、编号不回收及未知字段保留。
- 提供 `proceeding.py`、`authority.py`、`final_artifact.py`、`practice.py` 与 `casebench_view.py` 等入口；具体命令按对应阶段实现。
- 提供统一只读 Read Model，计算最近成果、下次程序事件、系列案件数量、定稿与 Authority 数量；展示端不各自重算。计划接口包括 `workspace`、`matter`、`practice-list`、`practice-show`，返回稳定 JSON。
- 保持 CaseBench Skill 可独立运行于 Codex、My Agents、WorkBuddy 等环境。

### DSH Integration

- 在 `integrations/dsh/` 独立承载 Plugin、Host/Client、Cordis、Settings 与 Right Sidebar UI。
- 先做小型技术 Spike，依据实施时的 DSH 版本核实 bundled-skill 注册方式；不自行创造安装协议，CaseBench Core Skill 仍只有一个权威源。
- Settings 只配置 CaseBench 工作区等必要选项；Right Sidebar 注册“案件工作台”入口。
- 工作台内部包含“案件”和“办案经验”两个视图。案件页提供搜索、Matter 列表、Matter 详情、关联 Proceeding、最近工作、定稿和 Authority；经验页提供 Practice Note 搜索/详情、来源 Matter、Issue/Artifact 与 Authority 追溯。
- 案件工作台只读调用 Core Read Model。窄侧栏使用列表到详情的 drill-down；宽屏可使用列表与详情并列。
- 刷新采用打开、切换 Matter 或用户点击 Refresh 时读取；第一版不运行后台 watcher。
- 打开文档时复用 DSH 已有资源查看机制；没有 renderer 时提供文件路径与打开能力，不自建预览器。

## 5. 明确不做

4.0 第一版不加入：Matter 自动识别或自动绑定、KDocs 缓存匹配、Proceeding 关系图、Matter 健康评分、自动沉淀经验、向量数据库、Embedding、RAG、知识图谱、客户/工时/收费管理、团队审批流、Calendar、To Do、Agent 自动编排、CaseBench 自有 Word/PDF 预览器、工作台内直接编辑案件数据。

## 6. 阶段路线

| 阶段 | 范围与主要交付 |
|---|---|
| Phase 0 · Scope Freeze | 入库本计划、更新路线图、冻结既有兼容边界、新增三项设计契约、确定 UI 名称。 |
| Phase 1 · Core Data Model | 增加可选 State 字段与 Practice 数据模型、必要 schema 和校验；旧 Matter 原样可读，不自动迁移。 |
| Phase 2 · Core Commands | 增加 Proceeding、Authority、Final Artifact、Practice 命令；写入统一遵循 snapshot → identity precheck → mutate → commit。 |
| Phase 3 · Read Model | 增加稳定 JSON 读取接口，供 CLI、Codex 与 DSH 共享相同摘要语义。 |
| Phase 4 · Practice Library | 完成 Authority、Practice Note、索引、用户确认后的 promote、精确去重与来源追溯；复用历史依据前要求重新核验。 |
| Phase 5 · DSH Bundle Skeleton | 建立 DSH Plugin 骨架，完成 Skill bundling/registration Spike、工作区配置及 Read Model 调用。 |
| Phase 6 · 案件工作台 UI | 只读案件列表、搜索、Matter 详情、系列案件、最近成果、定稿与 Authority 展示。 |
| Phase 7 · 办案经验 UI | 只读 Practice Note、Authority、来源 Matter 与核验提示。 |
| Phase 8 · Agent Workflow Integration | 实测建议、用户确认沉淀及新 Matter 中重新核验的完整交互。 |
| Phase 9 · Compatibility & Regression | 覆盖所有既有与新增契约，证明身份、旧事实、Issue、笔记、成果及迁移快照不被意外改写。 |
| Phase 10 · Release Candidate | 至少用普通诉讼、系列案件、破产及旧 3.2.8 Matter 做真实案件验证；不得只依赖 synthetic tests。 |

阶段完成必须以各阶段验收证据为准。此表是开发路线，不是功能完成清单。

## 7. Release 候选顺序

以下是计划顺序，实际发布时间以各阶段验收为准：

```text
3.2.8             当前稳定基线
4.0.0-alpha.1     Core Contract + Proceedings
4.0.0-alpha.2     Authority + Practice Library
4.0.0-beta.1      DSH Bundle + 案件工作台
4.0.0-beta.2      Practice UI + Workflow Integration
4.0.0-rc.1        真实案件验证
4.0.0             Stable
```

## 8. 4.0 完成定义

只有下列条件全部经过验证，才可称为 CaseBench 4.0：

1. 3.2.8 Matter 无需迁移即可继续使用。
2. 一个 Matter 可以承载多个 Proceeding。
3. 系列案件可以作为一个 Matter 在案件工作台中自然展示。
4. 普通案件不会因为 Proceeding 模型而增加明显使用复杂度。
5. 本案使用的法条和案例可以结构化记录。
6. 定稿成果可以稳定显示。
7. “最近工作”来自真实成果计算，而不是 AI 临时总结。
8. Practice Library 可以沉淀经过用户确认的个人办案经验。
9. AI 不会自动将讨论内容写入 Practice Library。
10. 历史经验进入新 Matter 前必须重新联网核验。
11. DSH Settings 只承担配置。
12. DSH Right Sidebar 提供“案件工作台”。
13. 窄侧栏采用 drill-down，宽屏采用 master-detail。
14. 案件工作台原则上只读。
15. DSH Plugin 不拥有第二套案件数据库。
16. Core Skill 仍可独立运行于 Codex、My Agents、WorkBuddy 等环境。
17. 不引入向量数据库、RAG、任务系统、日历系统或案件管理软件式复杂度。

产品关系保持：

```text
DSH         = 法律工作的 Harness
CaseBench   = 案件工作的协议与事实层
案件工作台  = CaseBench 在 DSH 中的可视化窗口
```
