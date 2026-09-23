# 法律案件工作台 · legal-case-bench

> 让 AI 的法律办案工作**沉淀在案件文件里，而不是留在聊天记录里**。
>
> A case-workbench skill for AI agents doing PRC legal work — the case workspace,
> not the chat log, is the source of truth.

支持 **WorkBuddy / myagents / Codex / DSH** 四个平台：同一套入口、同一套法律规则、
同一套目录协议与状态脚本，**不因为换了平台或模型就降低办案强度与质量标准**。

**Current stable Matter Foundation: 3.2.8** · [版本记录](CHANGELOG.md)

---

## 它解决什么问题

直接和 AI 聊案件，会反复撞上同一堵墙：

- **聊天记录不是事实源。** 换个会话、换个平台、换个模型，之前查清的事实、定下的策略、
  用户给过的指示全部蒸发，只能重新讲一遍，甚至讲漏。
- **结论不可追溯。** 哪句是原始材料写的、哪句是当事人主张、哪句是 AI 推断、哪句是最终结论，
  混在一段流畅的文字里无从分辨——而法律工作里这四者的分量完全不同。
- **复核没有位置。** "让另一个 AI 看一眼"如果只是再开一段对话，它读到的仍是你的转述，
  而不是案卷本身。
- **成果散落。** 检索报告、类案表格、过程稿 v1→v7、定稿副本各自躺在不同会话的下载目录里。

本技能把上述内容全部落进一个**确定的案件目录**，由脚本维护结构，由文件承载事实。

## 核心设计

| 原则 | 含义 |
|---|---|
| **文件即事实源** | 平台聊天、任务记录、模型缓存**都不是**共同事实源。需要跨平台复用的内容必须写进案件工作区。 |
| **一案一身份** | 每个案件有一个不可变的 `matter.id`（UUID）。改名、移动目录、切换平台都不改变它。 |
| **四层分离** | 原始材料 / 当事人主张 / AI 推断 / 最终结论分开承载，重要结论尽量可回溯到来源。 |
| **复核不自动派发** | 独立复核**完全由用户手动触发**。不因案件复杂、存在其他代理产物或准备定稿就自动派遣复核代理。 |
| **起草、自查、复核分开** | 三者分开标识，不混为一谈；复核卡只含待证命题与材料定位（混入过程稿或定稿会被脚本直接拦截）。 |
| **不覆盖原始文件** | 迁移与升级只动结构与元数据；笔记、过程稿、定稿、材料一律逐字节保留。 |
| **不推断** | 不确定时明确说明，不靠推测填缺口；分类拿不准就留 `unclassified`，不替用户判断。 |

## 安装

### 环境要求

- **Python 3.10 及以上**（推荐 3.12，迁移手册中的示例均使用 `python3.12`）。
- **无需 pip 安装任何依赖**：脚本仅依赖标准库与 PyYAML，PyYAML 副本已随仓库
  vendor 在 `scripts/vendor/yaml/`（许可见 `scripts/vendor/PyYAML-LICENSE`）。
  按下方步骤组装后，脚本会自动使用这份内置副本。
- 支持 macOS / Linux / Windows（WSL 或任一提供 `python3` 的环境）。

### 第一步：获取仓库

```bash
git clone https://github.com/vansonffff/legal-casebench.git
cd legal-casebench
```

本仓库是 `legal-case-bench` 的**脱敏源代码镜像**：只含技能规则、脚本与文档，
不含任何案件材料、内部运行日志或凭据。

### 第二步：按 manifest 组装到你的平台

`manifest.json` 描述了从镜像到安装目录的映射。以 DSH 为例（目标目录
`~/.dsh/skills/legal-case-bench/`；其他平台换成各自的技能目录即可）：

```bash
TARGET=~/.dsh/skills/legal-case-bench     # WorkBuddy / myagents / Codex 换成对应技能目录
mkdir -p "$TARGET"

# 1) 底座：四端共用的规则、脚本与 schema
cp -R skills/legal-case-bench/common/. "$TARGET/"

# 2) Codex 平台再叠加专用补充（其他平台跳过本行）
# cp -R skills/legal-case-bench/compat/codex/. "$TARGET/"

# 3) 共享成果协议与 vendor 依赖（manifest.json 的 includes / directory_includes）
mkdir -p "$TARGET/references" "$TARGET/scripts/vendor"
cp shared/references/research-artifacts.md "$TARGET/references/"
cp -R scripts/vendor/yaml "$TARGET/scripts/vendor/yaml"
cp scripts/vendor/PyYAML-LICENSE "$TARGET/scripts/vendor/PyYAML-LICENSE"

# 4) 许可证与技能元数据
cp skills/legal-case-bench/LICENSE "$TARGET/LICENSE"
cp skills/legal-case-bench/skill.yaml "$TARGET/skill.yaml"
```

组装后的安装目录应形如：

```text
<平台技能目录>/legal-case-bench/
├── SKILL.md                # 技能入口（Agent 每次先读它）
├── skill.yaml              # 技能元数据
├── LICENSE
├── references/             # 17+1 份规则文件，按任务渐进加载
│   ├── core-workflow.md
│   ├── …
│   └── research-artifacts.md   # 来自 shared/
└── scripts/                # 全部状态与结构脚本
    ├── matter.py
    ├── …
    └── vendor/yaml/        # 内置 PyYAML
```

### 第三步：冒烟验证（约 1 分钟）

不需要单独跑测试套件——用技能自带的 `init` + `validate` 在临时目录里
建一个演示案件并校验，通过即说明安装完整：

```bash
S=~/.dsh/skills/legal-case-bench/scripts    # 换成你的实际安装路径
DEMO=$(mktemp -d)

python3 "$S/matter.py" init --root "$DEMO" --name 冒烟验证案件 --actor dsh
python3 "$S/matter.py" validate --path "$DEMO/冒烟验证案件"
```

期望第二条的输出为 `"status": "valid"` 且 `warnings` 为空。随后删除临时目录即可：

```bash
rm -rf "$DEMO"
```

如果 `init` 报 `No module named 'yaml'`，说明第 3 小步的 vendor 目录没有复制到位，
请对照 `manifest.json` 的 `directory_includes` 检查。

### 升级与卸载

- **升级**：重新执行第二步即可。脚本与规则可以整体覆盖；**案件工作区不在安装目录里**，
  不受影响。若跨越架构版本（如 2.x → 3.x），存量案件按
  [迁移操作手册](docs/MIGRATION-3.0.md) 逐案迁移。
- **卸载**：删除安装目录。案件工作区（`~/Documents/My Legal-agents` 或你自定的根目录）
  是纯数据，不受任何影响。

## 快速上手

建一个案件工作区，然后建案：

```bash
S=~/.dsh/skills/legal-case-bench/scripts          # 换成你平台的安装路径

python3 "$S/matter.py" init --root ~/办案工作区 --name "示例案件" --actor dsh
python3 "$S/matter.py" validate --path ~/办案工作区/示例案件
```

得到这样的结构：

```text
~/办案工作区/
├── _registry.json                    # 全部 Matter 的机器可读登记
├── _INDEX.md                         # 总索引
└── 示例案件/
    ├── matter.yaml                   # Matter 身份与分类（Contract v1）
    ├── _case_state.json              # 唯一事实源：facts / issues / pending / reviews
    ├── 00-案件笔记.md                 # 案件脉络、指示、策略，按日期追加
    ├── 01-过程稿/                     # 检索成果、专项分析、成稿过程版本
    └── 02-定稿/                       # 复核通过的终稿副本
```

日常动作：

```bash
# 追加案件笔记（问题 / 用户指示 / 策略 / 事实线索 / 待办 …）
python3 "$S/case_note.py" append --case-dir ~/办案工作区/示例案件 \
  --harness dsh --category user_instruction \
  --question "举证期限是否可延长？" --conclusion "可申请延长，需在期限届满前提出"

# 开一个检索成果包（报告、结构化结果、去凭据原始响应一起登记）
python3 "$S/research_artifact.py" init --case ~/办案工作区/示例案件 \
  --type law --question "举证期限延长规则" --harness dsh
```

之后直接用自然语言提案件需求即可——读材料、写文书、做检索、复核、定稿，
技能会按任务渐进加载对应的规则文件。

## 覆盖的办案环节

| 环节 | 落点 |
|---|---|
| 建案 | `matter.yaml` + `_registry.json` 登记，分配不可变 `matter.id` |
| 材料通读 | 原始材料只读，识别结果写入 `01-过程稿/` |
| 法律与类案检索 | 检索成果包（`research-manifest.json` + 报告 + 去凭据原始响应） |
| 专项分析 | 分析成果包（`analysis-manifest.json`），不改写案件事实 |
| 事实与争点 | `_case_state.json` 的 facts / issues / pending_items；Issue 有稳定编号与引用关系 |
| 案件笔记 | `00-案件笔记.md`，按日期追加、可去重 |
| 起草与版本 | `01-过程稿/<任务>/20-过程稿/` v1→vN |
| 独立复核 | 复核卡 + 请求 + 结论四件套，文件中介、强制反锚 |
| 定稿 | `02-定稿/` 留档，状态回写 |

## Matter：案件的身份

CaseBench 3.0 起，每个案件是一个 **Matter**，由三份文件共同描述，靠不可变的 `matter.id` 绑定：

```text
matter.yaml（Contract v1）  ←→  _case_state.json（State v4）  ←→  _registry.json（v2）
                      由 matter.id (UUID) 绑定
```

```yaml
# matter.yaml（示例，节选）
schema_version: 1
matter:
  id: 00000000-0000-4000-8000-000000000000   # 示例 UUID，不用于真实案件
  code: null
  name: 示例案件
  aliases: []
  type: unclassified        # litigation / bankruptcy / non-litigation / …
  status: active
engagement:
  role: unknown             # 我们代表谁
procedure:
  kind: unknown
  stage: unknown
```

**为什么要有 Matter**：案件要跨会话、跨平台、跨模型被反复访问。
`matter.id` 保证无论目录改名、挪到哪个 Workspace、由哪个 Agent 接手，
系统都知道"这还是同一个案子"，不会重复建案、不会张冠李戴。

**迁移不推断分类**：旧案件迁移过来时，`type` / `role` / `stage` 一律留空
（`unclassified` / `unknown`），由使用者补齐——迁移工具不越界替用户判断案件性质。

旧版（`_case_state.json` schema v3）的案件可用一条命令升级，**默认先演练、不写入**：

```bash
python3 "$S/matter.py" migrate --case-dir "<案件>" --actor dsh          # 演练，不写任何东西
python3 "$S/matter.py" migrate --case-dir "<案件>" --apply --actor dsh  # 正式迁移
```

迁移会先建快照、记录每一个将被修改的文件，可完整回退；重复执行幂等，不会产生第二个身份。

> ⚠️ **迁移前请先自行备份整个案件工作区到独立介质。**
> 迁移事务自带的快照与案件工作区在**同一存储介质**上，只防迁移失败，
> 不防磁盘损坏或误操作，**不是灾备**。虽然迁移在作者环境已通过完整测试
> （含中断恢复与幂等演练），但你的案件数据只有一份，正式 `--apply` 之前
> 请把整个工作区根目录复制到另一块磁盘或可靠的云端。

详见 [迁移操作手册](docs/MIGRATION-3.0.md)
与 [Agent 向迁移契约](skills/legal-case-bench/common/references/matter-migration.md)。

## 命令速查

| 脚本 | 用途 |
|---|---|
| `matter.py` | `init` 建案 · `validate` 校验 · `show` 查看 · `migrate` 旧案迁移 |
| `case_note.py` | `append` 追加可去重的案件笔记 |
| `research_artifact.py` | `init` / `save-raw` / `record-source` / `finalize` 检索成果包 |
| `analysis_artifact.py` | `init` / `finalize` / `check-stale` 专项分析成果 |
| `issue.py` | `add` / `rename` / `link` / `list` 争点与引用关系 |
| `check_review.py` | `--list` / `--verify` / `--set-status` 复核卡与结论 |
| `make_review_card.py` | 生成复核卡（只含待证命题与材料定位，防反锚） |

> `register_case.py` 为旧版建案入口，仍可用但已标记弃用；新调用请用 `matter.py init`。

## 版本

```text
3.2.x   Matter Foundation（Matter Contract v1 / State v4 / Registry v2 / Legacy Migration）
3.3     Matter Module enrichment   （计划中）
3.4     Authority Layer            （计划中）
```

各版本含义见 [CHANGELOG.md](CHANGELOG.md)。
当前稳定版 **3.2.8**；Matter Foundation 已完成，迁移与完整恢复演练均已通过。

## 本仓库中的位置

```text
skills/legal-case-bench/          本技能
  common/                         四端共用的规则、脚本、schema、references
  compat/codex/                   Codex 专用补充说明
  evals/evals.json                泛化评测用例
  skill.yaml                      技能元数据
shared/references/                跨技能成果协议
scripts/vendor/                   隔离运行所需的 PyYAML 副本及其许可证
docs/                             面向使用者的迁移文档
```

本镜像不包含案件材料、案件笔记、状态文件、检索原始响应或凭据；示例与评测材料已作泛化处理。

## 延伸文档

- [CHANGELOG.md](CHANGELOG.md) —— 版本语义与变更记录
- [迁移操作手册](docs/MIGRATION-3.0.md) —— 面向使用者的旧案迁移步骤
- [Agent 向迁移契约](skills/legal-case-bench/common/references/matter-migration.md) —— 迁移边界与实现约束
- [检索成果协议](shared/references/research-artifacts.md) —— 检索报告、结构化结果与原始响应的落盘约定

## 许可

`legal-case-bench` 按 **MIT License** 发布，许可文本见 [`skills/legal-case-bench/LICENSE`](skills/legal-case-bench/LICENSE)。
此公开镜像仅包含该技能及配套文档；第三方 PyYAML 文件仍依其随附的 [`PyYAML-LICENSE`](scripts/vendor/PyYAML-LICENSE) 使用。
