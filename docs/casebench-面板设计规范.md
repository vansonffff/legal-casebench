# CaseBench 面板设计规范（v1.0，2026-10-03）

> 本面板（`integrations/dsh/client.js`）自 4.0.0-rc.5 起采用 dsh-bankruptcy-teamwork
> 已冻结的《面板设计规范 v1.0》（2026-10-03 冻结）。本文不复制该规范全文，
> 只记录 CaseBench 侧的落位与差异；两者冲突时以破产面板的冻结规范为准。
> 改规范本身须先与用户确认，并在本文末尾追加变更记录。

## 直接沿用（不重复定义）

- 五级字级：H1 = 主字号 +4px、H2 = +2px、H3 = 主字号加粗、正文 = 次字号、备注 = 次字号 −1px；
  主/次字号取 `--dsh-content-font-size` / `--dsh-content-font-size-secondary`，跟随用户字号设置。
- 颜色：只用 `--dsw-alias-label-primary/-secondary/-tertiary`、`--dsw-alias-border-l3`、
  `--dsw-alias-interactive-bg-hover`；不引入无出处颜色。
- 留白两条基准线：`PAD_X = 4px`（框外文字行）/ `BOX_PAD_X = 8px`（带边框组件），
  根容器留白 6px，文字左边落点 10/14px；禁止第三种水平数字。
- 组件：ROW（hover 行，不无条件 `width: 100%`）、BUTTON（真动作，`4px 10px`）、
  QUIET（返回/刷新类，无边框三级色、水平 padding 0）、INPUT、NOTICE_BOX、NOTE、DIVIDER。
- 吸顶页头：`sticky top 0` + 实测面板底色 + 同色 `box-shadow: 0 -10px 0 0` 上延遮滚动穿透；
  **禁止负 margin**。

## CaseBench 侧落位与差异

1. **吸顶底色变量名 `--cb-pane-bg`**：与破产面板 `--bt-pane-bg` 同一手法（挂载时向上找第一个
   非透明背景祖先实测写入，兜底 `--dsw-alias-bg-overlay`）。已知限制相同：只在挂载时实测一次，
   主题切换后需重新打开面板。
2. **PageHead**：各子页统一的吸顶页头（QUIET 返回 + H2 标题 + 可选右侧动作）。
   案件上下文页的吸顶头块合并了导航行、案件名（H2）、读取时间、小标签行（事实｜争点｜待办）
   与筛选行——一个吸顶块，避免两个 sticky 叠同一个 top 互相遮挡。
   可折叠段标题（Collapsible）用 H3，**不再各自 sticky**。
3. **SELECT（筛选下拉）**：破产规范没有筛选控件；CaseBench 新增，规格同 INPUT
   （0.5px 边框、8px 圆角、`5px 10px`），但宽度随内容（`width: auto`），不是通栏输入框。
   事实筛选 = 核验状态（四档分组，不逐码硬译）+ 事实类别（只列本案真实出现的取值）；
   待办筛选 = 全部 / 未完成 / 已完成（判定复用 `isSettledPending`，与加粗、计数、复选框同口径）。
4. **待办状态复选框**：面板唯一的写入口（`setPendingStatus` → Core `pending.py update-status`）。
   勾选态由 `isSettledPending` 决定；写入中禁用该复选框；写后重读上下文。
5. **成果条目整行单击打开**（ArtifactRow）：有 path 即可点行（hover 出底色），
   无 path 保持只读行；不再有独立的「打开」按钮行。
6. 滚动容器不带顶部内边距；顶部 12px 由第一个内容块提供（吸附线贴顶边，历史实测坑）。
7. **箭头槽（ArrowSlot）**：折叠段与去向行的箭头统一放右缘定宽槽（16px 居中），
   不跟在标题后面——否则箭头 x 位置随标题长度漂移、›/⌄ 字形宽度不同导致展开收起时左右跳。
8. **NavRow（去向行）**与 Collapsible 段标题同层级：字号统一 H3 字级，只靠字重区分
   重要性；计数格式统一为「名称 · 数量」（不用全角空格）。
9. **「重新读取」全局面板只有一个**（标题行右上角）：在上下文页它同样重读上下文；
   子页内不再放第二个。

## 变更记录

- v1.0（2026-10-03）：随 rc.5 建立，声明采用破产冻结规范并记录上述差异。
- v1.1（2026-10-03，rc.6）：用户截图验收后新增第 7–9 条（箭头槽、NavRow 字级与计数格式、
  「重新读取」去重）。
