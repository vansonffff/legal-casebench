/**
 * 轨线量测门禁（设计体系 2.0 §4.8）：在 headless 浏览器里渲染 preview-design.mjs 生成的
 * 静态预览（虚构样本），读出代表元素的真实左缘，核对 P / C / L 三条轨线与面板是否横向溢出。
 *
 * 用法：CASEBENCH_CHROME_HEADLESS=<chrome-headless-shell 或 Chrome 可执行文件> \
 *        node integrations/dsh/scripts/measure-rails.mjs [rails.json]
 *
 * 静态预览不等于真实桌面验收：它只能证明"同样的 DOM 在不同宽度下文字落在同一条轨上"，
 * 不能替代桌面深浅主题、吸顶与交互的人工核阅。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const browser = process.env.CASEBENCH_CHROME_HEADLESS;
if (!browser) throw new Error('请用 CASEBENCH_CHROME_HEADLESS 指定 headless 浏览器可执行文件。');
const output = process.argv[2] ? resolve(process.argv[2]) : null;
const work = await mkdtemp(join(tmpdir(), 'casebench-rails-'));
const preview = join(work, 'preview.html');

const built = spawnSync(process.execPath, [resolve(import.meta.dirname, 'preview-design.mjs'), preview], { encoding: 'utf8' });
assert.equal(built.status, 0, `预览生成失败：${built.stderr || built.stdout}`);

const flags = ['--no-sandbox', '--disable-gpu', `--user-data-dir=${join(work, 'profile')}`, '--virtual-time-budget=3000', '--dump-dom'];
// chrome-headless-shell 本身就是 headless；完整 Chrome 需要显式进入新版 headless。
if (!basename(browser).includes('headless-shell')) flags.unshift('--headless=new');
const dump = spawnSync(browser, [...flags, `file://${preview}?measure=1`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
assert.equal(dump.status, 0, `headless 渲染失败：${dump.stderr || dump.stdout}`);
const found = dump.stdout.match(/<pre id="cb-measure">([\s\S]*?)<\/pre>/);
assert.ok(found, '预览未输出量测结果（缺少 #cb-measure）：预览脚本的 ?measure=1 分支可能被改坏');
const measured = JSON.parse(found[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));

// 每个页面的量测期望：探针名 → 轨线（page = P，content = P+16，leading = P+32，page-8 = Surface Bleed 外扩）。
const EXPECT = {
  '案件列表': [['first-tab', 'page'], ['shell-title', 'page'], ['current-case-label', 'page'], ['search', 'page'], ['bare-row-box', 'page-8'], ['bare-row-text', 'page'], ['case-meta', 'page']],
  // 未选择案件：同一套标题格式（「当前案件：待选择」+ 一行小字），轨线必须与选择后一致。
  '未选择案件': [['first-tab', 'page'], ['shell-title', 'page'], ['current-case-label', 'page'], ['current-case-meta', 'page'], ['search', 'page'], ['bare-row-box', 'page-8'], ['bare-row-text', 'page'], ['case-meta', 'page']],
  // 案件详情这一页：分区不做灰卡（分区行是裸行、底色外扩 8px），页面本身不再重复写案件标题
  // ——标题与阶段身份由面板顶部的「当前案件」一行承担。
  '案件详情': [['first-tab', 'page'], ['shell-title', 'page'], ['breadcrumb', 'page'],
    ['current-case-label', 'page'], ['current-case-meta', 'page'],
    ['section-row', 'page'], ['section-row-text', 'page'], ['artifact-title', 'page']],
  '事实筛选': [['first-tab', 'page'], ['shell-title', 'page'], ['breadcrumb', 'page'], ['fact-text', 'page']],
  '待办': [['first-tab', 'page'], ['shell-title', 'page'], ['breadcrumb', 'page'], ['todo-check', 'checkbox'], ['todo-text', 'leading']],
  // 办案经验这张卡里的行：底色铺满整张卡（行盒落在页面轨 P），文字仍落在卡内容轨 P+16。
  '办案经验': [['first-tab', 'page'], ['shell-title', 'page'], ['breadcrumb', 'page'], ['page-title', 'page'],
    ['surface-reading', 'content'], ['surface-row', 'page'], ['surface-row-text', 'content']],
  '800px 宽栏阅读': [['first-tab', 'page'], ['shell-title', 'page'], ['breadcrumb', 'page'], ['fact-text', 'page']],
};
// 必须**不存在**的探针：分区行不得再被灰色卡片包住；案件详情不得再有页面级标题（重复）。
const ABSENT = { '案件详情': ['section-row-in-card', 'page-title'], '事实筛选': ['page-title'], '待办': ['page-title'], '800px 宽栏阅读': ['page-title'] };
const railAt = (gutter, rail) => gutter + { page: 0, checkbox: 2, 'page-8': -8, content: 16, leading: 32 }[rail];
// 控件与行高的实测期望（2.0 §3.3 / §6.4 / §12）：标准控件 36px、复选框 20px、导航行 ≥40px。
const SIZE = { search: [36, 36], 'todo-check': [16, 16], 'surface-row': [30, Infinity], 'bare-row-box': [48, 96],
  'section-row': [48, 48], 'first-tab': [36, 36] };
// 每个探针的字号/行高期望（2.0 §3.1 / §5.1 / §15 / §19）。字级错了与轨线错了同样算门禁失败。
const TYPE = {
  'shell-title': ['20px', '28px'], 'page-title': ['20px', '28px'], breadcrumb: ['13px', '18px'],
  search: ['14px', '20px'], 'bare-row-box': ['14px', '20px'], 'bare-row-text': ['14px', '22px'],
  'case-meta': ['12px', '18px'],
  'surface-row': ['14px', '20px'], 'surface-row-text': ['14px', '20px'],
  'surface-reading': ['14px', '22px'], 'fact-text': ['14px', '22px'],
  'todo-text': ['14px', '22px'], 'section-row': ['14px', '22px'],
  'section-row-text': ['14px', '22px'], 'first-tab': ['14px', '22px'],
  'current-case-label': ['13px', '18px'], 'current-case-meta': ['12px', '18px'],
  'artifact-title': ['14px', '20px'],
};
// 字重期望：分区/导航标题 500，展开后的文件条目 400（用户 2026-10-03：条目不要加粗）。
const WEIGHT = { 'section-row-text': '500', 'artifact-title': '400' };

let checks = 0;
const lines = [];
for (const [page, expectations] of Object.entries(EXPECT)) {
  const hosts = measured.hosts.filter((host) => host.page === page);
  assert.equal(hosts.length, 2, `页面「${page}」应有浅色/深色两份预览，实际 ${hosts.length} 份`);
  for (const host of hosts) {
    // §31.6：窄侧栏不得出现横向溢出（溢出会被 overflow-x:hidden 静默裁掉，这里靠 scrollWidth 抓出来）。
    assert.ok(host.panel, `页面「${page}」缺少面板节点`);
    assert.ok(host.panel.scrollWidth <= host.panel.clientWidth + 1,
      `页面「${page}」(${host.theme}) 横向溢出：scrollWidth ${host.panel.scrollWidth} > clientWidth ${host.panel.clientWidth}`);
    for (const probe of ABSENT[page] || []) {
      assert.ok(!host.probes[probe], `页面「${page}」(${host.theme}) 不该出现 ${probe}：这一页的分区不应再套灰色卡片`);
    }
    for (const [probe, rail] of expectations) {
      const sample = host.probes[probe];
      assert.ok(sample, `页面「${page}」(${host.theme}) 缺少探针 ${probe}：预览 fixture 可能已改动`);
      const expected = railAt(host.gutter, rail);
      assert.ok(Math.abs(sample.left - expected) <= 1,
        `页面「${page}」(${host.theme}) ${probe} 应落在 ${rail} 轨 ${expected}px，实际 ${sample.left}px`);
      // 原生复选框没有 2.0 字级期望（它是浏览器绘制的小控件），只核位置。
      const type = TYPE[probe];
      if (type) {
        assert.equal(sample.fontSize, type[0], `页面「${page}」(${host.theme}) ${probe} 字号应为 ${type[0]}`);
        assert.equal(sample.lineHeight, type[1], `页面「${page}」(${host.theme}) ${probe} 行高应为 ${type[1]}`);
      }
      const size = SIZE[probe];
      if (size) {
        assert.ok(sample.height >= size[0] - 0.5 && sample.height <= size[1] + 0.5,
          `页面「${page}」(${host.theme}) ${probe} 高度应在 ${size[0]}–${size[1]}px，实际 ${sample.height}px`);
      }
      const weight = WEIGHT[probe];
      if (weight) {
        assert.equal(sample.fontWeight, weight, `页面「${page}」(${host.theme}) ${probe} 字重应为 ${weight}`);
      }
      lines.push(`${page.padEnd(12)} ${host.theme.padEnd(5)} ${probe.padEnd(15)} ${rail.padEnd(8)} 期望 ${expected} 实际 ${sample.left} ${sample.fontSize}/${sample.lineHeight}/${sample.fontWeight} 高 ${sample.height} 底 ${sample.background}`);
      checks++;
    }
  }
}
// 面板顶部的当前案件名称：它前面还有 13px 的标签，不按轨线断言，只核 20/28/500。
const nameHosts = measured.hosts.filter((host) => EXPECT[host.page] && host.probes['current-case-name']);
assert.ok(nameHosts.length >= 10, `当前案件名称实测覆盖不足（${nameHosts.length}），门禁可能已失效`);
for (const host of nameHosts) {
  const sample = host.probes['current-case-name'];
  assert.equal(sample.fontSize, '20px', `页面「${host.page}」(${host.theme}) 当前案件名称应为 20px`);
  assert.equal(sample.lineHeight, '28px', `页面「${host.page}」(${host.theme}) 当前案件名称行高应为 28px`);
  assert.equal(sample.fontWeight, '500', `页面「${host.page}」(${host.theme}) 当前案件名称字重应为 500`);
  lines.push(`当前案件名  ${host.page.padEnd(12)} ${host.theme.padEnd(5)} ${sample.fontSize}/${sample.lineHeight}/${sample.fontWeight}`);
  checks++;
}
// 选中标签必须**实测**为透明底：只钉源码字符串挡不住宿主样式或状态样式再给一块灰底。
// 选中项可能是行里的第 1/2/3 个，所以不按轨线断言，单独核底色、字级与高度。
const tabHosts = measured.hosts.filter((host) => EXPECT[host.page] && host.probes['selected-tab']);
for (const host of tabHosts) {
  const sample = host.probes['selected-tab'];
  // 不只是 background：渐变、内阴影、伪元素都可能是"灰底"的载体（宿主样式会这么画）。
  assert.equal(sample.background, 'rgba(0, 0, 0, 0)',
    `页面「${host.page}」(${host.theme}) 选中标签必须完全透明，实际底色 ${sample.background}`);
  assert.equal(sample.backgroundImage, 'none',
    `页面「${host.page}」(${host.theme}) 选中标签不得有背景图/渐变，实际 ${sample.backgroundImage}`);
  assert.equal(sample.boxShadow, 'none',
    `页面「${host.page}」(${host.theme}) 选中标签不得有内阴影，实际 ${sample.boxShadow}`);
  for (const [which, content, background] of [['::before', sample.beforeContent, sample.beforeBackground], ['::after', sample.afterContent, sample.afterBackground]]) {
    assert.ok(content === 'none' || content === 'normal', `页面「${host.page}」(${host.theme}) 选中标签的 ${which} 不得有内容，实际 ${content}`);
    assert.equal(background, 'rgba(0, 0, 0, 0)', `页面「${host.page}」(${host.theme}) 选中标签的 ${which} 不得有底色，实际 ${background}`);
  }
  assert.equal(sample.fontSize, '14px', `页面「${host.page}」(${host.theme}) 标签字号应为 14px`);
  assert.equal(sample.lineHeight, '22px', `页面「${host.page}」(${host.theme}) 标签行高应为 22px`);
  assert.ok(sample.height >= 35.5 && sample.height <= 36.5,
    `页面「${host.page}」(${host.theme}) 标签高度应为 36px，实际 ${sample.height}px`);
  lines.push(`选中标签  ${host.page.padEnd(12)} ${host.theme.padEnd(5)} 底色 ${sample.background} ${sample.fontSize}/${sample.lineHeight} 高 ${sample.height}`);
  checks++;
}
assert.ok(tabHosts.length >= 10, `选中标签实测覆盖不足（${tabHosts.length}），门禁可能已失效`);
assert.ok(checks >= 40, `量测覆盖不足（${checks} 项），门禁可能已失效`);
if (output) await writeFile(output, `${JSON.stringify(measured, null, 1)}\n`);
console.log(lines.join('\n'));
console.log(`\n轨线量测：${checks} 项全部通过（P/C/L ±1px，无横向溢出）`);

// 分割线必须共享同一个容器轨，不能按带 Surface Bleed 的按钮宽度计算。
for (const host of measured.hosts.filter(host => host.page === '案件详情')) {
  assert.equal(host.dividers.length, 5);
  for (const divider of host.dividers) {
    assert.ok(Math.abs(divider.left - host.gutter) <= 1, '分割线左缘应落页面轨');
    assert.ok(Math.abs(divider.width - (host.panel.clientWidth - 2 * host.gutter)) <= 1, '分割线长度应一致');
  }
}
console.log('案件详情浅深色的 5 条分割线：左右端点与长度一致');

// 列表分割线（用户 2026-10-04）：事实行、待办行之间各一条 1px 细线。
// 案件列表按用户同一轮的要求不划线（只留案件名，保持首页洁净）→ 期望 0 条；
// 争点行是可点卡片；办案经验共用同一个列表但未要求 → 0 条。
// 这里不只核位置，还要核 ::before 的 content——「规则写了但从未渲染」是这个仓库真实踩过的坑。
const LIST_DIVIDERS = { '案件列表': 0, '事实筛选': 1, '待办': 1, '争点搜索': 0 };
for (const [page, expected] of Object.entries(LIST_DIVIDERS)) {
  const hosts = measured.hosts.filter(host => host.page === page);
  assert.equal(hosts.length, 2, `页面「${page}」应有浅色/深色两份预览，实际 ${hosts.length} 份`);
  for (const host of hosts) {
    assert.ok(host.panel, `页面「${page}」缺少面板节点`);
    // 按**已渲染**的线条数核对：候选节点存在但 ::before 没画出来时，painted=false。
    const painted = host.listDividers.filter(divider => divider.painted);
    assert.equal(painted.length, expected,
      `页面「${page}」(${host.theme}) 已渲染的列表分割线应有 ${expected} 条，实际 ${painted.length} 条`);
    // 案件列表要的是「有行、但没有线」：候选节点必须存在，否则 0 条说明不了问题（可能只是 fixture 空了）。
    if (page === '案件列表') {
      assert.ok(host.listDividers.length > 0,
        `页面「${page}」(${host.theme}) 没有量到案件行候选节点：fixture 或选择器可能已改动，0 条线不成立`);
    }
    for (const divider of painted) {
      assert.equal(divider.content, '""',
        `页面「${page}」(${host.theme}) 分割线必须真的渲染出来，实际 content=${divider.content}`);
      assert.ok(Math.abs(divider.left - host.gutter) <= 1,
        `页面「${page}」(${host.theme}) 分割线左缘应落页面轨 ${host.gutter}px，实际 ${divider.left}px`);
      assert.ok(Math.abs(divider.width - (host.panel.clientWidth - 2 * host.gutter)) <= 1,
        `页面「${page}」(${host.theme}) 分割线长度应与页面轨一致，实际 ${divider.width}px`);
      assert.ok(Math.abs(divider.height - 1) <= 0.5,
        `页面「${page}」(${host.theme}) 分割线应为 1px，实际 ${divider.height}px`);
      assert.notEqual(divider.background, 'rgba(0, 0, 0, 0)',
        `页面「${page}」(${host.theme}) 分割线不得是透明线（必须跟随主题边框色）`);
      // 纵向必须落在节距中点：贴住上一条或下一条都会被看成分组线而不是分隔线。
      assert.ok(Math.abs(divider.lineTop + divider.gapAbove / 2) <= 1,
        `页面「${page}」(${host.theme}) 分割线应在 ${divider.gapAbove}px 节距的中点，实际线顶 ${divider.lineTop}px`);
      checks++;
    }
  }
}
console.log('事实／待办列表分割线：条数正确、落页面轨、1px 且跟随主题；案件列表有行但不划线；争点行不加');

// 行盒横向几何（用户 2026-10-04：修「几何不对称」）：裸行与争点行靠 margin-inline:-8px 做 Surface Bleed，
// 底色必须**左右各外扩 8px 且对称**；卡内行靠 -surface-padding-x 铺满整张卡，左右都要落页面轨。
// 这条门禁按真实行盒量，正是为了挡住「内联 width:100% 把负右外边距反算掉」那类回退。
const BLEED_EXPECT = { '案件列表': ['bare', 8], '争点搜索': ['issue', 8], '办案经验': ['card', 0] };
for (const [page, [kind, bleed]] of Object.entries(BLEED_EXPECT)) {
  const hosts = measured.hosts.filter(host => host.page === page);
  assert.equal(hosts.length, 2, `页面「${page}」应有浅色/深色两份预览，实际 ${hosts.length} 份`);
  for (const host of hosts) {
    const rows = host.bleedRows.filter(row => row.kind === kind);
    assert.ok(rows.length > 0, `页面「${page}」(${host.theme}) 没有量到 ${kind} 行盒：预览 fixture 或选择器可能已改动`);
    const railRight = host.panel.clientWidth - host.gutter;
    for (const row of rows) {
      const leftBleed = host.gutter - row.left;
      const rightBleed = row.right - railRight;
      assert.ok(Math.abs(leftBleed - bleed) <= 1,
        `页面「${page}」(${host.theme}) ${kind} 行左缘应${bleed ? `外扩 ${bleed}px` : '落页面轨'}，实际 ${leftBleed.toFixed(1)}px`);
      assert.ok(Math.abs(rightBleed - bleed) <= 1,
        `页面「${page}」(${host.theme}) ${kind} 行右缘应${bleed ? `外扩 ${bleed}px` : '落页面轨'}，实际 ${rightBleed.toFixed(1)}px`);
      assert.ok(Math.abs(leftBleed - rightBleed) <= 1,
        `页面「${page}」(${host.theme}) ${kind} 行左右必须对称：左 ${leftBleed.toFixed(1)}px / 右 ${rightBleed.toFixed(1)}px`);
      checks++;
    }
  }
}
console.log('行盒横向几何：裸行/争点行左右各外扩 8px 且对称，卡内行铺满整张卡（不外扩不内缩）');

for (const host of measured.hosts.filter(host => host.page === '案件详情')) {
  assert.equal(host.bands.length, 6);
  for (const band of host.bands) {
    assert.equal(band.radius, '0px');
    assert.equal(band.margin, '0px');
    assert.equal(band.height, 48);
    assert.ok(Math.abs(band.left - host.gutter) <= 1);
    assert.ok(Math.abs(band.width - (host.panel.clientWidth - 2 * host.gutter)) <= 1);
  }
}
console.log('6个入口热区：全宽48px、零外边距、直角，覆盖分割线之间区域');

// 未选择案件时，标题信息槽必须与选择后一样铺满：「当前案件：待选择」+ 一行小字。
// 用户 2026-10-04 反馈：未选择时只有一行裸文本，占不满 48px 信息槽，它到下方搜索框之间空出一大截；
// 选择案件后间距正常。这里按实测几何核对两种状态的间距一致（±1px），并核对空状态两行的字级。
for (const theme of ['light', 'dark']) {
  const selected = measured.hosts.find(host => host.page === '案件列表' && host.theme === theme);
  const empty = measured.hosts.find(host => host.page === '未选择案件' && host.theme === theme);
  assert.ok(selected?.headerGap && empty?.headerGap, `${theme}：缺少标题信息槽到搜索框的量测`);
  assert.ok(Math.abs(selected.headerGap.searchTop - empty.headerGap.searchTop) <= 1,
    `${theme}：未选择案件时搜索框顶边应 ${selected.headerGap.searchTop}px，实际 ${empty.headerGap.searchTop}px（间距与选择后不一致）`);
  // 关键口径：信息槽里**文字的底边**。旧实现只有一行裸文本，槽底还空着 28px，
  // 用户看到的就是"这句话离下方太远"；外框底边（min-height 撑的）两种状态一样，量不出问题。
  assert.ok(Math.abs(empty.headerGap.textBottom - selected.headerGap.textBottom) <= 1,
    `${theme}：未选择案件时文字底边应 ${selected.headerGap.textBottom}px，实际 ${empty.headerGap.textBottom}px（信息槽没铺满）`);
  // 文字底边到搜索框的节奏也必须与选择后相同（不是靠外框对齐碰巧相等）。
  assert.ok(Math.abs((empty.headerGap.searchTop - empty.headerGap.textBottom) - (selected.headerGap.searchTop - selected.headerGap.textBottom)) <= 1,
    `${theme}：文字到搜索框的间距应与选择后一致`);
  // 空状态的两行：名称位 20/28/500（与案件名同格式）、小字 12/18（与「阶段待确认 · 上诉人」同格式）。
  const name = empty.probes['current-case-name'], meta = empty.probes['current-case-meta'];
  assert.ok(name && meta, `${theme}：未选择案件时缺少名称或小字探针`);
  assert.deepEqual([name.fontSize, name.lineHeight, name.fontWeight], ['20px', '28px', '500'],
    `${theme}：待选择的字级应与案件名一致，实际 ${name.fontSize}/${name.lineHeight}/${name.fontWeight}`);
  assert.deepEqual([meta.fontSize, meta.lineHeight], ['12px', '18px'],
    `${theme}：空状态小字的字级应与「阶段待确认 · 上诉人」一致，实际 ${meta.fontSize}/${meta.lineHeight}`);
  checks += 2;
}
console.log('未选择案件：标题信息槽铺满，间距与搜索框位置与选择后一致（浅深色±1px）');

for (const theme of ['light', 'dark']) {
  const pages = measured.hosts.filter(host => host.theme === theme && host.contentStart !== null);
  assert.equal(pages.length, 3);
  for (const page of pages) assert.ok(Math.abs(page.contentStart - pages[0].contentStart) <= 1, '三个上下文子页正文起点必须一致');
}
console.log('事实／争点搜索／待办正文起点一致（浅深色±1px）');

for (const host of measured.hosts.filter(host => host.page === '争点搜索')) {
  assert.ok(host.issueCorners.length > 0);
  for (const corner of host.issueCorners) {
    assert.equal(corner.radius, '12px');
    assert.ok(corner.leftClearance >= 0 && corner.rightClearance >= 0, '争点两侧圆角不得被滚动区裁切');
  }
}
console.log('争点12px左右圆角均在滚动区可见范围内');
