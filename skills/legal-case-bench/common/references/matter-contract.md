# Matter Contract v1

## 定位

`matter.yaml` 是共同案件工作区中的 Matter Identity Contract。它回答“这是哪个 Matter、具有什么稳定的案件属性”，不承载事实库、运行状态或完整聊天上下文。

Contract 的版本与 CaseBench 版本、`_case_state.json` 的 schema 版本、Registry 版本分别管理。当前约定是：

```text
CaseBench 3.2.x（Matter Foundation；本文档对应 3.2.8）
matter.yaml schema_version: 1
_case_state.json schema_version: 4（新建 Matter 直接生成；存量旧案经 legacy migration 升级为 4）
Registry schema_version: 2（matters[] 为权威、cases[] 为派生镜像；旧案条目经 migration 迁入 matters[]）
```

### Registry v2 的权威性

```text
Registry v2
  ├── matters[]    ← authoritative，正式 Registry
  └── cases[]      ← legacy compatibility projection，由 matters 派生
```

读取方在 schema v2 下一律只信 `matters[]`；旧程序若仍读 `cases[]` 仅是兼容。
写入方只有一条逻辑：**更新 `matters[]` → 派生 `cases[]`**，不得把二者当两个 Source of Truth
分别维护，否则迟早出现 `matters.matter_id = AAA` 而 `cases.matter_id = BBB`。
尚未迁入 `matters[]` 的旧条目原样保留。

版本路线图：

```text
3.1.x  Phase 3 preview / internal release（历史版本，勿再引用为当前约定）
3.2.x  Matter Foundation —— 当前稳定线（3.2.8）
       Matter Contract v1、Matter ID、State v4、Registry v2、Issue linkage、
       legacy migration（含完整恢复路径）
3.3    Matter Module enrichment（房地产破产正式 Module）
3.4    Authority Layer
```

## Compatibility Contract（自 CaseBench 3.0 起冻结）

下列结构自 3.0（Matter Architecture 完成）起进入兼容契约。**一旦有正式案件落盘，
就只能演进、不能改设计**；新增字段必须向前兼容，读取器必须保留未知字段。

| 结构 | 版本 | 位置 |
|---|---|---|
| Matter Contract | `schema_version: 1` | `<case>/matter.yaml` |
| Case State | `schema_version: 4` | `<case>/_case_state.json` |
| Registry | `schema_version: 2` | `<root>/_registry.json` |
| Migration journal | `journal_version: 1` | `<root>/.migration/journal-<指纹>.json` |
| Snapshot manifest | `journal_version: 1` | `<root>/.migration/matter-v1-*/manifest.json` |
| Migration report | `report_version: 1` | `<root>/.migration/reports/*.md` |

其中 **`matter.id` 是不可变的身份锚点**：它一经正式案件生成，
既不随改名/移动目录/切换 Workspace 变化，也不得因迁移工具重跑而重新生成。
所有迁移、恢复、并发路径都必须复用它——这就是"一个 legacy case 只有一个 Matter ID"。

Registry 的权威性同样冻结：`matters[]` 是权威，`cases[]` 只是兼容投影，
读取方在 v2 下一律只信 `matters[]`。

### 快照目录名的时间戳（3.2.2 起用 UTC）

`<root>/.migration/matter-v1-<stamp>-<案件指纹>/` 中的 `<stamp>`：

```text
3.2.2 起  %Y-%m-%dT%H%M%SZ       例：<UTC-timestamp>      ← UTC
3.2.1 及更早  <本地时间>-<本地偏移>  例：<local-timestamp>-<offset>
```

3.2.1 及更早的实现用 `.replace("+", "-")` 让文件名"安全"，把本机 `+0800` 写成了 `-0800`，
而 `-0800` 在 ISO-8601 里表示 UTC−8，**与真实偏移相差 16 小时**。
这是"看起来合法、含义却相反"的 metadata，因此改为 UTC：跨时区稳定、排序稳定、无偏移转义问题。

**已产生的旧快照不改名**——journal 按绝对路径引用它们，改名会切断 journal↔snapshot 链路。
因此 `.migration/` 下允许两种命名并存，**任何按目录名排序或解析时间的做法都必须改为读
manifest 的 `created_at`**（恢复演练脚本已照此修正）。

快照时间的**权威来源始终是 `manifest.created_at` 与 journal 的 `started_at`**；
这两个字段保留本地偏移（ISO-8601 忠实写法），不受上述命名规则影响。

## Matter Root

正式 Matter Root 是包含有效 `matter.yaml` 的案件目录：

```text
<案件目录>/
├── matter.yaml
├── 00-案件笔记.md
├── _case_state.json
├── 01-过程稿/
└── 02-定稿/
```

从当前工作目录向父级查找时，使用最近的 `matter.yaml`；不得根据目录名猜测 Matter，也不得把 DSH Workspace、KDocs drive 或 Harness ID 当作 Matter 主键。查找边界由调用方提供的 workspace root 限制，不能越过文件系统根目录。

详细解析规则见 `matter-resolution.md`。

## Source of Truth

### `matter.yaml`

权威负责：

- `matter.id` 这一稳定身份；
- 名称、别名、人类编号和基本分类；
- 管辖信息；
- 律师团队的正式事务角色；
- 程序类型和阶段；
- 稳定的工作治理要求；
- Matter Module 声明；
- 外部资源绑定位置。

其中 `matter.id` 是 UUID，创建后不因改名、移动目录、切换 Workspace 或更换外部资源而变化。`matter.name` 和 `matter.code` 都可以修改，不能充当主键。

### 副本纪律

`matter.id` 与目录名、路径无关，这是刻意设计。由此产生的工作流纪律：

- **把整个案件目录复制，默认仍是同一个 Matter 的两个物理副本**，不生成新身份，系统也不检测分叉；
- 同一 Matter 的多个副本**不应并行编辑**（`.case-bench.lock` 只在单目录内生效，跨副本无保护）；
- 需要派生为**新的独立 Matter** 时，必须显式走 clone/new-matter，由 `matter.py init` 生成新 UUID。

不为检测副本分叉引入机器 ID、目录 ID 或注册中心，避免把 Matter Identity 与 Workspace Instance 混为一谈。

### 迁移快照的边界

`<root>/.migration/` 下的迁移快照**不是灾备**：

```text
Migration snapshot protects against migration failure,
NOT against disk loss / filesystem corruption.
```

它与案件工作区处于同一存储介质，用途只有事务级恢复/回滚取证，安全级别不等同于备份。
真正的灾备需要独立介质。快照 manifest 的 `snapshot_status` 为 `valid` 才可作为可信恢复点；
备份窗口内源文件发生变化时会标为 `invalid`。

### Matter 结构完整性

`matter.yaml` 回答“我是谁”，`_case_state.json` 回答“我现在怎么样”。因此：

```text
有 matter.yaml，但没有 _case_state.json
= Matter structure incomplete
= Error（MatterStateMissing），validate 非零退出
```

这不是“合法但略欠完整”，也不自动创建 state。校验只负责报告不完整，不负责修复。

### `_case_state.json`

权威负责：

- facts；
- issues；
- pending items；
- research artifacts；
- analysis artifacts；
- reviews、handoff 和其他运行状态。

3.0 起新建 Matter 的状态文件直接带 `matter_id`，必须与 `matter.yaml.matter.id` 一致。读取侧校验：状态文件带有 `matter_id` 且不一致时必须停止；旧的 schema v3 状态没有该字段时只报告兼容性提示，不在本阶段改写状态。

写入侧同样受身份预检保护：`state_update.py` 的 commit 在落盘前会读取状态目录下的 `matter.yaml` 并比对 `matter_id`；不一致立即停止（`MatterIdConflict`），matter.yaml 本身无效时同样停止。没有 `matter.yaml` 的旧案不受影响。`upgrade_case_state.py` 检测到状态已由 Matter Contract 托管时拒绝执行，防止把 State v4 降级回 v3。

### `00-案件笔记.md`

权威负责：

- 用户口径；
- 策略演变；
- 阶段总结；
- 决策过程；
- 重要指示；
- 叙事性的案件历史。

案件笔记不是 Matter manifest 的替代品，也不应被结构化状态静默覆盖。

## Schema v1 的边界

完整机器可读约束在同目录的 `schemas/matter.schema.json`，本节只说明语义边界。

```yaml
schema_version: 1

matter:
  id: UUID                         # 必填、稳定、不变
  code: SH-BK-2026-017             # 可选、人类编号
  name: 案件显示名称                # 必填、可改名
  aliases: []                      # 可选、历史名称
  type: bankruptcy                 # 必填、固定基础词汇
  subtypes: []                     # 可选、细分标签
  status: active                   # 可选、显示状态

jurisdiction:
  country: null                    # canonical skeleton：未知一律 null，不自动填 CN
  province: null
  city: null
  court: null
engagement:
  role: unknown                    # 未知时保持 unknown
procedure:
  kind: unknown
  stage: unknown
governance:
  case_tier: null
modules: []
bindings: {}
metadata: {}
```

基本类型只使用：`litigation`、`bankruptcy`、`non-litigation`、`other`、`unclassified`。无法从可靠结构化资料确定时使用 `unclassified`；正式角色未知时使用 `unknown`。不得由模型根据目录名、材料标题或案件叙述自动猜测类型、角色或程序阶段。

**`jurisdiction` 属 Matter identity，与 `type` / `role` 同等对待**：`null` 就是 `unknown`。即使当前工作主要在中国境内，也不得把"没有信息"写成 `country: CN`。只有调用方显式给出才写入——`matter.py init --country CN --province 上海 --city 上海 --court 上海市第三中级人民法院`。

`matter.py init` 与 legacy migration 生成**同一套 canonical skeleton**（键与顺序一致），下游读取方不需要为两条路径各处理一套形状。

`engagement.role` 是律师团队的正式 Matter 角色，不等于某次任务的 Perspective。一次任务可以从投资人、债权人或被告等 Perspective 分析，而不改变 Matter 的正式角色。

## Bindings 与凭据

`bindings` 只记录资源位置，例如 provider 和 ref：

```yaml
bindings:
  documents:
    provider: kdocs
    ref: drive-id
```

不得写入 token、password、secret、cookie、API key、OAuth access/refresh token 或认证头。登录方式和凭据由对应 provider/plugin 管理。校验器发现凭据样式时应报 `MatterCredentialLeak`，不得尝试脱敏后继续保存。

## 向前兼容

读取器必须保留未知字段，不因当前版本不认识就删除或改写。已知字段若类型不正确则拒绝通过；未知字段的存在本身不是错误。新增字段应优先留在合适的 Matter 分区，不能把动态 facts/issues 或报告正文塞入 `matter.yaml`。

## 当前命令边界

当前已提供：

```text
matter.py init
matter.py validate
matter.py show
issue.py add | rename | link | list
```

`matter.py init` 只负责新 Matter；它不读取旧案内容来猜测类型、角色或程序阶段。旧的 `register_case.py` 仍可调用同一初始化逻辑，但会提示已废弃。

已落地：State v4 直发、全部 state 写入口的 Matter ID preflight、Issue 稳定编号与引用关系。
`issue.py` 只服务 State v4；在旧 state 上调用返回 `LegacyMatterNeedsMigration`，不会就地升级。

**`upgrade_case_state.py` 的边界**：它只服务 **Matter 之前** 的存量 state，任何下列情形一律 hard stop（`StateGuardError`，非零退出、零写入）：

```text
状态目录存在 matter.yaml        → 该目录是 Matter Root，只能走 matter.py / state_update.py
schema_version >= 4 且有 matter_id → 已由 Matter Contract 托管，禁止降级为 v3
schema_version >= 4 但无 matter_id → 损坏的 Matter 状态，禁止按 legacy migration 处理
有 matter_id 但无 schema_version   → 版本无法确认，拒绝处理
```

即：**它与其他写入口一样受身份边界约束**，不会被排除在 Matter ID preflight 之外。

**已完成**（3.2.x）：legacy 案件的识别与迁移（`matter.py migrate`，默认 dry-run）、
既有 State v3 → v4 升级、Registry v1 → v2 升级、`matter.id` 生成与复用、
事务化写入与按快照完整恢复。正式案件的 rollout 已完成。

**尚未做**：`matter.py rename / set / bind / modules`、Artifact 的 `matter_id` / `issue_refs`
关联、Matter Module、Matter-first workflow —— 按 3.3 / 3.4 分阶段实现。

## 错误词汇

对调用方保持稳定的错误类别：

```text
MatterNotFound
MatterSchemaUnsupported
MatterInvalid
MatterStateMissing
MatterIdConflict
MatterRegistryConflict
MatterModuleConflict
MatterCredentialLeak
LegacyMatterNeedsMigration
```

当前实际使用 `MatterNotFound`、`MatterSchemaUnsupported`、`MatterInvalid`、`MatterStateMissing`、`MatterIdConflict`、`MatterRegistryConflict`、`MatterCredentialLeak` 和 `LegacyMatterNeedsMigration`；其他类别仍为后续阶段预留，避免各脚本自行发明同义错误。

其中身份与结构校验分工：

- `MatterIdConflict`：`matter.yaml` 与 state 的 Matter ID 不一致，或 state 身份无法确认时的冲突。
- `MatterStateMissing`：有 `matter.yaml` 但没有 `_case_state.json`，Matter 结构不完整。它是 `MatterInvalid` 的子类，便于既有捕获逻辑兼容，同时 `code` 可单独识别。
- `LegacyMatterNeedsMigration`：state 缺 `matter_id`（未迁移的 v3），写入被拒绝；旧案迁移需显式执行 matter.py migrate。
- `MatterSchemaUnsupported`：state 版本不在支持范围，或 Matter 托管状态被降级到 v3。
