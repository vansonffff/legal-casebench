# CaseBench · 法律案件工作台（legal-case-bench）

> 让 AI 的法律办案工作**沉淀在案件文件里，而不是留在聊天记录里**。
>
> A case-workbench skill for AI agents doing PRC legal work — the case workspace,
> not the chat log, is the source of truth.

支持 **WorkBuddy / myagents / Codex / DSH** 四个平台：同一套入口、同一套法律规则、
同一套目录协议与状态脚本，**不因为换了平台或模型就降低办案强度与质量标准**。

**当前 Core：4.0.0-rc.7 · DSH 插件：4.0.0-rc.8（候选发布）** · 稳定版 **3.2.8**（tag `v3.2.8`） · [版本记录](CHANGELOG.md)

4.0 在 3.2.8 的 Matter Foundation 之上新增：

- **Proceeding**：一个 Matter 承载多个关联程序（系列案件、一审/二审/再审），各有独立案号、阶段与开庭事件；
- **Authority Reference**：本案使用的法条与案例结构化登记，附带核验状态、时间与来源；
- **Final Artifact 登记**：`02-定稿/` 的正式文件结构化留档；
- **Practice Library（办案经验库）**：经用户明确确认后沉淀的跨案办案认识与外部依据；
  AI 只有"发现权"，入库决定权在用户；历史经验进入新案件前必须重新联网核验；
- **CaseBench Read Model**：统一只读 JSON 视图（`casebench_view.py`），供各端一致读取；
- **DSH 案件工作台**：DSH 右侧栏的原生可视化入口（含待办状态写回）（见下方"安装方式二"）。

## 本次同步（DSH rc.8，Core rc.7）

- 会话案件跟随与身份/哈希保护的争点引用。
- 事实核验状态/类别筛选，待办状态筛选及完成状态写回。
- 统一页头、标题、计数和导航箭头；只保留右上角「重新读取」。
- 打开文件后切回工作台，恢复原案件详情或二级菜单与展开状态；硬刷新或重启会清空 UI 记忆。
- 修复上下文页头遮罩覆盖上方按钮底边。

DSH rc.8 沿用 Core rc.7，统一设计体系、修复行盒左右外扩不对称；事实与待办之间增加分割线，案件列表小字统一为「案件类型 · 我方立场」，未选择案件与选中态使用同一标题及间距。

公开镜像含插件回归、虚构样本预览、轨线量测门禁与独立待办测试。验证仅覆盖源码、临时夹具及静态预览；真实桌面交互需另行验收。

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
即使 DSH 可视化界面消失，CaseBench 案件工作区本身仍然完整存在。

## 核心设计

| 原则 | 含义 |
|---|---|
| **文件即事实源** | 平台聊天、任务记录、模型缓存**都不是**共同事实源。需要跨平台复用的内容必须写进案件工作区。 |
| **一案一身份** | 每个案件有一个不可变的 `matter.id`（UUID）。改名、移动目录、切换平台都不改变它。 |
| **四层分离** | 原始材料 / 当事人主张 / AI 推断 / 最终结论分开承载，重要结论尽量可回溯到来源。 |
| **复核不自动派发** | 独立复核**完全由用户手动触发**。不因案件复杂、存在其他代理产物或准备定稿就自动派遣复核代理。 |
| **起草、自查、复核分开** | 三者分开标识，不混为一谈；复核卡只含待证命题与材料定位（混入过程稿或定稿会被脚本直接拦截）。 |
| **经验不自动入库** | AI 可在重要检索/分析后**建议**沉淀办案经验，只有用户明确确认才写入 `_practice/`。 |
| **历史经验仅供回忆** | 历史法条/案例在新案件使用前必须重新联网核验真实性、效力与适用性；经验库不承担核验职能。 |
| **不覆盖原始文件** | 迁移与升级只动结构与元数据；笔记、过程稿、定稿、材料一律逐字节保留。 |
| **不推断** | 不确定时明确说明，不靠推测填缺口；分类拿不准就留 `unclassified`，不替用户判断。 |

---

## 安装方式一：AI Agent 技能（四个平台通用）

这是 CaseBench 本体。无论是否使用 DSH 可视化插件，都需要先装它。

### 环境要求

- **Python 3.10 及以上**（推荐 3.12）。
- **无需 pip 安装任何依赖**：脚本仅依赖标准库与 PyYAML，PyYAML 副本已随仓库
  vendor 在 `scripts/vendor/yaml/`（许可见 `scripts/vendor/PyYAML-LICENSE`）。
- 支持 macOS / Linux / Windows（WSL 或任一提供 `python3` 的环境）。

### 第一步：获取仓库

```bash
git clone https://github.com/vansonffff/legal-casebench.git
cd legal-casebench
```

本仓库是 `legal-case-bench` 的**脱敏源代码镜像**：只含技能规则、脚本、插件与文档，
不含任何案件材料、内部运行日志或凭据。

### 第二步：按 manifest 组装到你的平台

`manifest.json` 描述了从镜像到安装目录的映射。各平台技能目录：

| 平台 | 技能目录 |
|---|---|
| DSH | `~/.dsh/skills/legal-case-bench/` |
| Codex | `~/.codex/skills/legal-case-bench/` |
| WorkBuddy | `~/.workbuddy/skills/legal-case-bench/` |
| myagents | `~/.myagents/skills/legal-case-bench/` |

以 DSH 为例（其他平台换成上表对应目录）：

```bash
TARGET=~/.dsh/skills/legal-case-bench
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
├── references/             # 规则文件，按任务渐进加载
│   ├── core-workflow.md
│   ├── proceedings.md          # 4.0 多程序
│   ├── authority-references.md # 4.0 本案依据
│   ├── practice-library.md     # 4.0 办案经验
│   ├── final-artifacts.md      # 4.0 定稿登记
│   ├── …
│   └── research-artifacts.md   # 来自 shared/
├── schemas/
└── scripts/                # 全部状态与结构脚本
    ├── matter.py
    ├── proceeding.py           # 4.0
    ├── authority.py            # 4.0
    ├── final_artifact.py       # 4.0
    ├── practice.py             # 4.0
    ├── casebench_view.py       # 4.0 只读 Read Model
    ├── …
    └── vendor/yaml/            # 内置 PyYAML
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
  不受影响。4.0 新字段（proceedings / authority_refs / final_artifacts）全部为可选增量，
  旧案件原样合法，**不需要批量迁移**。若跨越架构版本（如 2.x → 3.x），存量案件按
  [迁移操作手册](docs/MIGRATION-3.0.md) 逐案迁移。
- **卸载**：删除安装目录。案件工作区（`~/Documents/My Legal-agents` 或你自定的根目录）
  是纯数据，不受任何影响。

---

## 安装方式二：DSH 案件工作台插件（可选，右侧栏可视化）

这是 CaseBench 在 DSH 里的**可视化入口**：右侧栏"案件工作台"浏览案件、
程序、开庭节点、最近成果、定稿、本案依据和办案经验。**它只是窗口**——
案件数据仍以文件工作区为唯一事实源，插件不保存独立的案件数据库。唯一写入口是待办完成/未完成状态，沿用 Core 的锁、哈希预检与身份校验；其余浏览字段只读。

### 前提

- 已按"安装方式一"装好技能（Agent 会话用的是技能目录里的脚本）。
- 使用与插件 Cordis 4 / Typert 0.1.7-rc.2 依赖兼容的 DSH 版本；升级前检查当前运行时的兼容提示。
- Python 3.12（插件默认按命令名 `python3.12` 调用；找不到时见下方配置）。

### DSH 网页端（web profile）

在克隆后的仓库根目录执行：

```bash
dsh plugin --profile web add "$(pwd)/integrations/dsh"
```

然后**重启 DSH Host**，已打开的浏览器页面**硬刷新**（Cmd+Shift+R）。

插件为本地目录链接安装：`integrations/dsh/dist/skill/` 已随仓库组装入库，无需构建步骤。
如需打包安装，也可以在 `integrations/dsh/` 下 `npm pack` 后对生成的 `.tgz` 执行同样的命令。

### DSH 桌面端（Electron app）

桌面 profile 由 Electron app 独占管理，命令行无法安装：

1. 打开桌面 app 的**插件面板**；
2. 安装来源填本地目录路径：`<克隆路径>/integrations/dsh`；
3. **重启桌面 app**。

> **桌面端特别注意**：Electron 宿主的 `PATH` 只有系统目录，按名找不到
> `python3.12`。如果装好后右栏读不到案件数据，在桌面 profile 的
> `cordis.patch.yml` 里给插件配置绝对路径后重启：
>
> ```yaml
> - id: legal-casebench
>   config:
>     python: /你的/python3.12/绝对路径   # 用 which python3.12 查询
> ```

### 配置

插件配置项（loader 行 `config`）：

| 键 | 默认 | 含义 |
|---|---|---|
| `root` | `~/Documents/My Legal-agents` | CaseBench 案件工作区根目录 |
| `python` | `python3.12` | 执行 Read Model 的 Python 解释器 |

### 验证

- DSH **设置**里出现"案件工作台"，显示工作区根目录、Core 版本与已发现 Matter 数；
- 右侧栏 Guide 出现"案件工作台"入口，打开后能看到案件列表与"办案经验"标签。

---

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
├── _practice/                        # 4.0 办案经验库（经确认后才写入）
└── 示例案件/
    ├── matter.yaml                   # Matter 身份与分类（Contract v1）
    ├── _case_state.json              # 唯一事实源：facts / issues / pending / reviews
    │                                 #   + 4.0 可选增量：proceedings / authority_refs / final_artifacts
    ├── 00-案件笔记.md                 # 案件脉络、指示、策略，按日期追加
    ├── 01-过程稿/                     # 检索成果、专项分析、成稿过程版本
    └── 02-定稿/                       # 复核通过的终稿副本
```

之后直接用自然语言提案件需求即可——读材料、写文书、做检索、复核、定稿，
技能会按任务渐进加载对应的规则文件。例如：

- "二审已经立案了，案号是……" → 登记 Proceeding；
- "下个月 12 日上午九点半开庭，记一下" → 登记开庭事件；
- "这个案例以后还有价值，沉淀下来" → 核验后写入办案经验库。

## 覆盖的办案环节

| 环节 | 落点 |
|---|---|
| 建案 | `matter.yaml` + `_registry.json` 登记，分配不可变 `matter.id` |
| 多程序 | `proceedings[]`：系列案件、一二审再审，各有案号/阶段/开庭事件 |
| 材料通读 | 原始材料只读，识别结果写入 `01-过程稿/` |
| 法律与类案检索 | 检索成果包（`research-manifest.json` + 报告 + 去凭据原始响应） |
| 本案依据 | `authority_refs[]`：法条/案例 + 核验状态、时间与来源 |
| 专项分析 | 分析成果包（`analysis-manifest.json`），不改写案件事实 |
| 事实与争点 | `_case_state.json` 的 facts / issues / pending_items；Issue 有稳定编号与引用关系 |
| 案件笔记 | `00-案件笔记.md`，按日期追加、可去重 |
| 起草与版本 | `01-过程稿/<任务>/20-过程稿/` v1→vN |
| 独立复核 | 复核卡 + 请求 + 结论四件套，文件中介、强制反锚 |
| 定稿 | `02-定稿/` 留档 + `final_artifacts[]` 登记（含 sha256） |
| 办案经验 | `_practice/`：Practice Note + Authority，经确认沉淀、复用前重新核验 |

## Matter：案件的身份

每个案件是一个 **Matter**，由三份文件共同描述，靠不可变的 `matter.id` 绑定：

```text
matter.yaml（Contract v1）  ←→  _case_state.json（State v4）  ←→  _registry.json（v2）
                      由 matter.id (UUID) 绑定
```

**为什么要有 Matter**：案件要跨会话、跨平台、跨模型被反复访问。
`matter.id` 保证无论目录改名、挪到哪个 Workspace、由哪个 Agent 接手，
系统都知道"这还是同一个案子"，不会重复建案、不会张冠李戴。

4.0 起，一个 Matter 可以承载多个 **Proceeding**（程序）：系列案件的每个关联案件、
同一纠纷的一审/二审/再审，各自登记案号、法院、阶段、状态与开庭事件；
普通单程序案件的界面不会出现"Proceeding"这个技术概念。

**迁移不推断分类**：旧案件迁移过来时，`type` / `role` / `stage` 一律留空
（`unclassified` / `unknown`），由使用者补齐——迁移工具不越界替用户判断案件性质。

旧版（`_case_state.json` schema v3）的案件可用一条命令升级，**默认先演练、不写入**：

```bash
python3 "$S/matter.py" migrate --case-dir "<案件>" --actor dsh          # 演练，不写任何东西
python3 "$S/matter.py" migrate --case-dir "<案件>" --apply --actor dsh  # 正式迁移
```

> ⚠️ **迁移前请先自行备份整个案件工作区到独立介质。**
> 迁移事务自带的快照与案件工作区在**同一存储介质**上，只防迁移失败，
> 不防磁盘损坏或误操作，**不是灾备**。

详见 [迁移操作手册](docs/MIGRATION-3.0.md)
与 [Agent 向迁移契约](skills/legal-case-bench/common/references/matter-migration.md)。

## 命令速查

| 脚本 | 用途 |
|---|---|
| `matter.py` | `init` 建案 · `validate` 校验 · `show` 查看 · `migrate` 旧案迁移 |
| `proceeding.py` | `add` / `list` / `show` / `update` 程序 · `add-event` / `update-event` 开庭与节点 |
| `authority.py` | `add` / `verify` / `list` 本案法条与案例依据 |
| `final_artifact.py` | `register` / `list` 定稿登记 |
| `practice.py` | `promote`（需 `--confirmed-by-user`）· `list` / `show` 检索 · `prepare-reuse` 复用问题卡 |
| `casebench_view.py` | `workspace` / `matter` / `practice-list` / `practice-show` 只读 Read Model |
| `pending.py` | `update-status --case-dir <目录> --item-id <编号> --status open/completed --actor dsh` |
| `case_note.py` | `append` 追加可去重的案件笔记 |
| `research_artifact.py` | `init` / `save-raw` / `record-source` / `finalize` 检索成果包 |
| `analysis_artifact.py` | `init` / `finalize` / `check-stale` 专项分析成果 |
| `issue.py` | `add` / `rename` / `link` / `list` 争点与引用关系 |
| `check_review.py` | `--list` / `--verify` / `--set-status` 复核卡与结论 |
| `make_review_card.py` | 生成复核卡（只含待证命题与材料定位，防反锚） |

> `register_case.py` 为旧版建案入口，仍可用但已标记弃用；新调用请用 `matter.py init`。

## 版本

```text
3.2.x        Matter Foundation（Matter Contract v1 / State v4 / Registry v2 / Legacy Migration；稳定线）
4.0.0-rc.7   CaseBench Core + 办案经验库 + DSH 案件工作台（候选发布）
```

各版本含义见 [CHANGELOG.md](CHANGELOG.md)。

## 本仓库中的位置

```text
skills/legal-case-bench/          技能本体
  common/                         四端共用的规则、脚本、schema、references
  compat/codex/                   Codex 专用补充说明
  skill.yaml                      技能元数据
integrations/dsh/                 DSH 案件工作台插件（Cordis Host + Typert Remote + 右侧栏）
  dist/skill/                     组装好的随包技能（由 common/ 生成，勿手改）
shared/references/                跨技能成果协议
scripts/vendor/                   隔离运行所需的 PyYAML 副本及其许可证
docs/                             迁移手册与 4.0 计划/契约文档
```

本镜像不包含案件材料、案件笔记、状态文件、检索原始响应、内部评估数据或凭据。

## 延伸文档

- [CHANGELOG.md](CHANGELOG.md) —— 版本语义与变更记录
- [CaseBench 4.0 整体开发计划](docs/CASEBENCH-4.0-PLAN.md) —— 4.0 的产品原则与范围冻结
- [4.0 增量契约](docs/CASEBENCH-4.0-CONTRACTS.md) —— Proceeding / Authority / Practice 契约
- [迁移操作手册](docs/MIGRATION-3.0.md) —— 面向使用者的旧案迁移步骤
- [检索成果协议](shared/references/research-artifacts.md) —— 检索报告、结构化结果与原始响应的落盘约定

## 许可

`legal-case-bench` 按 **MIT License** 发布，许可文本见 [`skills/legal-case-bench/LICENSE`](skills/legal-case-bench/LICENSE)。
此公开镜像仅包含该技能、DSH 插件及配套文档；第三方 PyYAML 文件仍依其随附的
[`PyYAML-LICENSE`](scripts/vendor/PyYAML-LICENSE) 使用。
