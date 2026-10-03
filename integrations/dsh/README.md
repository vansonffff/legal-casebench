# CaseBench DSH Integration

CaseBench Core 的原生 DSH 只读入口。`integrations/dsh/` 承载 Cordis Host、Typert Remote、Settings 与右侧栏“案件工作台”；Matter、成果和 `_practice/` 仍以 CaseBench 文件为唯一事实源。

## 开发与装载

```bash
pnpm install --ignore-scripts
pnpm run assemble:skill
pnpm test
dsh plugin --profile web add /absolute/path/to/integrations/dsh
```

`assemble:skill` 从 `skills/legal-case-bench/common/` 生成 `dist/skill/`，同时带入 CaseBench 的 vendor YAML 与检索成果引用。不要手工编辑 `dist/skill/`。安装后须重启 DSH Host，已打开的页面须硬刷新，才能看到新 Host 与 Client。

在 DSH Profile 中配置 `legal-casebench` loader 行的 `config.root`（CaseBench 工作区）与 `config.python`。Settings 页面显示当前根目录、Core 版本和已发现 Matter；右侧栏负责案件与办案经验浏览。插件不写 `_practice/`；对 `_case_state.json` 的唯一写入是待办状态写回（`setPendingStatus` → Core `pending.py update-status`，经工作区锁、基线哈希预检与 Matter 身份预检落盘，只接受 `open`/`completed` 规范值）。

当前冻结版本 `4.0.0-rc.7`（随包 Core 与版本号一致）。CaseBench Core 仍可不依赖 DSH 独立运行；只有 DSH 可视化入口使用本包。

面板在同一会话内记住离开时的案件详情、二级菜单及折叠状态。打开成果文件后重新点击「案件工作台」页签，会按原案件指针重读并恢复页面；不同会话隔离，主动返回或切换案件遵循新的导航。记忆只在当前 Client 生命周期内有效，硬刷新或重启后不保留；不把案件内容写进浏览器持久存储。

rc.5：面板视觉切换到已冻结的《面板设计规范 v1.0》（字级跟随用户字号设置、PAD_X/BOX_PAD_X 留白基准、QUIET/BUTTON 分工、各子页吸顶页头）；事实增加核验状态与类别筛选、待办增加状态筛选；最近工作与定稿/法条/案例子页的条目整行单击打开（取消独立「打开」按钮行）；待办行首复选框直接写回完成/未完成。设计细节见仓库 `docs/casebench-面板设计规范.md`。

beta.1.1 修复同一来源 Matter 的经验行标识冲突、切换标签残留、成果按钮的 DSH tab hook 与 session 文件地址；`unknown` 程序阶段显示为“阶段待确认”。

beta.1.2 将角色、阶段、程序状态、成果类型、依据类型及核验状态统一显示为中文，并检查设置页、经验复用提示、日期和错误提示。显示层翻译不改写规范字段；原始标题、正文、文件路径和来源地址保留。

rc.1 完成真实案件验证（17 程序系列 Matter 浏览器实测、真实对话沉淀两条经验）；rc.2 将默认案件根等本机绝对路径改为 `Path.home()` 表达，公开镜像不再需要发布期替换。桌面端安装走 Electron app 插件面板；其宿主 PATH 仅系统目录，`config.python` 需配绝对路径。

只读浏览器回归（需指定已有 Playwright Core 的入口，不自动安装依赖）：

```bash
CASEBENCH_PLAYWRIGHT=/absolute/path/to/playwright-core/index.mjs node scripts/probe-ui.mjs
```

脚本用本地真实工作区校对行数与标题，反复切换两标签，打开 Markdown 并比对正文，再打开 Word 验证原生 PDF 预览。认证链接不写日志，不修改案件内容。

中文界面回归使用同一环境：`node scripts/probe-localization.mjs`，逐个访问案件详情、定稿/法条/案例页面、经验详情和设置页。

## rc.4 会话跟随与引用保护

案件上下文先跟随最近已发送用户消息中的案件引用；没有引用时，从当前会话工作区和声明的附加目录按 Core 规则解析 Matter。多个案件时展示候选供选择。可手动切换案件，再通过“恢复跟随会话”返回自动模式。草稿、模型消息与展开快照不参与案件选择。

新引用包含 Matter ID、真实路径、争点 ID 和状态哈希；插入前和模型准备展开时均核对身份与状态。核验状态的限定语保留，核验信息和立场确信度变化会改变哈希。请求乱序或切换会话后返回的旧结果不会覆盖当前页面，异步校验期间草稿变化也不会被覆盖。超长快照优先保留争点字段和成果指针，并说明省略量。

使用已安装桌面分发件进行隔离 Host 验证（临时工作区，无模型调用）：

```bash
CASEBENCH_PYTHON=/absolute/path/to/python3.12 node scripts/probe-native-host.mjs
```

可通过 `CASEBENCH_DESKTOP_EXECUTABLE` 和 `CASEBENCH_DESKTOP_RUNTIME` 指定桌面程序与其 bundled DSH 路径。该探针核验真实 Host 激活、Remote、pre-step 展开与 Client 资源服务；浏览器挂载需要单独实测。历史引用点击回看留待后续版本。
