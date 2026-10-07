# CaseBench DSH 设计体系落位记录

视觉与交互规则以 [DSH 插件视觉与交互设计体系 2.0（Native Metrics Revision）](../../DSH/docs/DSH-PLUGIN-DESIGN-SYSTEM-2.0.md)（2026-10-03）为准。本文件记录实现落位，不另建独立规范。

## 轨线与密度

- 页面轨 P：面板宽度小于 520px 使用 16px gutter，其余使用 24px。标题、面包屑、标签组、搜索外边界和 Surface 外缘共用 P（§4.2）。
- 内容轨 C：Surface 内文字位于 P+16px。卡内行**不再归零水平内边距**，而是把底色外扩一个卡内边距、内边距补回来：底色铺满整张卡（左缘落在 P），文字仍落在 P+16。
- 裸行 Surface Bleed：连续对象（案件、成果、去向行）文字落在 P，Hover/Selected 背景向两侧各外扩 8px（`margin-inline:-8px; padding-inline:8px`）——背景可以外长，文字不动（§4.4）。
- 卡片内部底色铺满时，卡片本身 `overflow:hidden`，让直角被卡的圆角裁掉；卡内行的焦点圈改为 `outline-offset:-3px`，否则会被裁掉。
- 行盒的几何（水平内边距、外边距、圆角）**只在 PANEL_CSS 里定义**：一旦内联写死，裸行与卡内行就无法区分（`ROW` 里曾内联 `border-radius`/`padding`，`H3` 里曾内联 `margin`，两次都压掉了 CSS）。
- Leading：复选框列宽 20px、间隔 12px；待办文字位于 P+32px。标题续行、辅助信息与更新反馈共用文字列。
- 行高：导航行 40px、对象行 48px、案件行 56px（§3.3 / §6.4），由行组件**内联**下发（min-height 只能内联，见下）。
- **案件详情这一页的分区不做灰色卡片**（用户 2026-10-03 要求「简单点」）：最近工作 / 关联案件 / 案件上下文 / 已定稿·法条·案例都是裸行（`cb-flat`），**全页只有一套节距**——行高 40px（对象行按内容）、行与行 4px、展开前后同节距（实测 9 行间距全为 4.0px）。不再有"组内紧、组间松"的区分，也不用分隔线。卡片只留给真正独立的数据分组（案件案号、办案备注、结果区）。
- 其它页面仍用 Surface 卡片；卡片间共用一套规格：圆角 20px、内边距 12/16px（§4.5「同一页面同类 Surface 必须一致」）。**卡片不要再加 `minHeight`**：`.cb-content` 是 content-box，`minHeight:64` 会渲染成 88px（内容 64 + 上下内边距 24），正是「折叠卡比导航卡高一截」的原因。
- 控件：搜索与筛选 36px / 12px 圆角 / 14px 字（§12.1、§22）；主操作（引用到对话）40px（§12.2）；面包屑 13/20、热区 36px（§15）；标签 14/22、6px 纵向内边距 + 2px 下划线 = 36px（QUIET 的 7px 会变成 38px，必须显式写）。
- 搜索外边界从 Page Rail 开始（§4.2），占位文字按控件自身 12px 水平内边距内缩；这是本插件对该条的落位方式，未按"文字与裸行同轨"处理——那样需要把控件外边界外扩 12px，反而违反 §4.2。
- 标签（主标签与上下文小标签）：选中只靠文字色、字重与 2px 下划线，**任何状态都不铺灰底**（含 hover 与 pressed）；`!important` 覆盖宿主可能给出的灰块（用户 2026-10-03 指出「已有下划线就别再上灰底」）。
- **当前案件不铺常驻灰底**：选中/当前只用 `aria-current` 与字重 500 表达，背景恒为透明（用户 2026-10-03：选过案件再回列表，那行的灰底会一直留着）。交互反馈只有 hover / active。`--plugin-interactive-selected` 与 `SELECTED` 常量已删除。
- 面板顶部的「当前案件」一行**就是案件详情页的标题**：`当前案件：` 标签 13/20，案件名 **16/24/500**（§5.1 子页标题 / §5.3 案件名），下面 12/18 跟它的阶段与身份（`matterMeta`：只拼接数据里真实存在的字段，从工作区列表来的案件没有 role 就不会写「角色待确认」）。详情页 PageHead 因此只留「← 返回」，不再重复写案件名与阶段身份（用户 2026-10-03：上下两处都写，重复了）。右侧用与折叠段一致的箭头槽（`›`/`⌄`），不用省略号、不铺灰底；展开后的「切换案件 / 恢复跟随会话」是次级操作 13/20，「工作区 / 选择来源」是技术信息 12/18。
- 展开后的文件条目（最近工作的成果、已定稿/法条/案例的下级列表）字重 **400**：只有分区标题（最近工作 · 18 / 案件上下文 / 已定稿 · 1）才是 500（用户 2026-10-03：展开后的文件列表不要用加粗字号）。

## 字级与字重

- 页面/对象标题 20/28/500（§5.1、§5.3）；争点标题 15/24/500（§19.2）；正文、节标题与对象标题 14/22/400–500；面包屑 13/20；元信息 12/18（§3.1）。
- Reading：事实、办案备注、待办正文 14/24，条目间距 20px，宽度上限 720px、靠左（§6.3、§18）。
- **字重只有 400 / 500**（§5.1）：正文 400；节标题、对象标题、选中行、选中标签、已完成的待办为 500。面板内不得出现 600/700——改用 500 后，"已完成待办"仍由 500 与复选框勾选态共同表达。
- 字级与行高的实测门禁见 `integrations/dsh/scripts/measure-rails.mjs`。

## 宿主与交互

插件根容器透明，背景从宿主实际不透明祖先读取，深浅主题同步更新 Surface Token；ResizeObserver 按实际面板宽度更新 gutter。子页头贴顶，使用不透明背景，无上延阴影，禁止纵向负边距（吸附按 margin 边判定）。底部留白 24px，保留可见焦点及错误边界。

页面恢复、会话跟随、筛选、成果整行打开和待办写回机制保留。顶部摘要从正在展示的案件详情或上下文取名。经验详情关联依据使用当前文档的 authorities。未改变 Core/Host 协议或真实案件数据。

**空闲不重绘（用户 2026-10-03 报「面板一直闪烁」）**：`syncFollow` 的回合结束 effect 只能依赖 `summary?.running` 这个原始值。若依赖 sessions store 里的 `summary` 对象引用，就会出现「重读关联 → 宿主写会话状态 → summary 换引用 → 再重读」的空转回环，空闲时也每 250ms 重绘一次。第二道保险：`sameJson` 比较只读视图，深度相同就返回原引用（React 直接跳过重绘），follow / matter / context 三处都做。

## 四条"写了不生效"的坑（已修，勿回退）

行内样式压过 CSS，这几类规则只能内联下发：

1. 行高：`HoverRow` 下发的 `minHeight` 以内联样式为准，`.cb-nav-row{min-height:40px}`、`[data-kind="case"]{min-height:64px}` 从未生效（实测渲染全部 56px）。现由 `ROW_MIN` 内联下发。
2. 面包屑字级：`.cb-breadcrumb button{font-size:13px}` 被 QUIET 的行内字号压掉（实测仍 14/22）。现由 `QUIET_BREADCRUMB` 内联下发。
3. 卡内行的几何：`ROW` 里内联的 `border-radius`、`H3` 里内联的 `margin` 会把卡内行的 `margin-inline/padding-inline/border-radius` 覆盖掉，底色铺不满卡（实测 `surface-row` 停在 P+16）。现已把行盒几何全部收进 PANEL_CSS，行组件只写垂直内边距。
4. 去向分隔线：`.cb-navigation .cb-nav-row + .cb-nav-row{border-top:…}` 被 `ROW` 内联的 `border:none` 压掉，从来没渲染过（实测 `borderTopWidth=0`）。现在**不再用分隔线**，分组交给间距；若将来确要分隔线，只能用 `box-shadow: inset 0 1px 0 0 …`（box-shadow 不受内联 border 影响）。
5. **两条 `!important` 相撞时看优先级，不看书写顺序**：通用 hover `.cb-panel button:not(:disabled):not(.cb-primary):hover` 是 (0,4,1)，比标签那条 `.cb-panel .cb-tab:hover` 的 (0,3,0) 高，所以"后面再补一条 `background:transparent!important`"完全无效——标签悬停时会被刷上灰底（用户实测反馈）。修法是**在源头 `:not()` 排除**：`.cb-panel button:not(:disabled):not(.cb-primary):not(.cb-tab):hover`、`.cb-panel summary:not(.cb-current-summary):hover`。凡是"某个状态不要底色"的诉求，先看有没有更高优先级的通用规则在管这件事。

**量测必须量对状态**：标签透明只在**未悬停**时量等于没量。悬停态用真实鼠标事件（CDP `Input.dispatchMouseEvent`）在真实宿主里验证，并带一个"应当变色"的对照组（案件列表行悬停应得 `--plugin-interactive-hover`），否则"全透明"可能只是没悬停上。

`measure-rails.mjs` 会分别核对轨线、字号行高、控件高度与**计算后的底色**（标签必须透明，含 background-image / box-shadow / 伪元素四类通道），上述任一回归都会失败（已用反向对照验证）。

## 验证与预览

```bash
cd integrations/dsh && npm test
node integrations/dsh/scripts/preview-design.mjs Agents/过程稿/casebench-native-metrics-20261003/preview.html
CASEBENCH_CHROME_HEADLESS=/path/to/chrome-headless-shell \
  node integrations/dsh/scripts/measure-rails.mjs Agents/过程稿/casebench-native-metrics-20261003/rails.json
CASEBENCH_PYTHON=/absolute/path/to/python3.12 node integrations/dsh/scripts/probe-native-host.mjs
```

预览由实际 Client 组件生成、使用虚构数据：`?rails=1` 显示 P/C/L 核验线，`?measure=1` 输出量测 JSON。默认输出目录为 `Agents/过程稿/casebench-native-metrics-20261003/`。静态预览不执行组件事件，不替代真实 Host 与桌面深浅主题验收。

历次证据：`Agents/过程稿/casebench-视觉重构-20261003/`（第一轮）、`Agents/过程稿/casebench-对齐密度-20261003/`（第二轮）、`Agents/过程稿/casebench-native-metrics-20261003/`（本轮 2.0）。
