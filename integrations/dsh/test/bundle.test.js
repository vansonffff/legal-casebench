import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { INVOCATIONS } from '../src/remote/invocations.js';
import { TYPERT } from '../typert.host.js';
import { TYPERT_REMOTE } from '../typert.remote-client.js';

test('Host、Client Remote 方法逐项一致', async () => {
  assert.deepEqual(TYPERT.invocations.map((x) => x.method), INVOCATIONS.map((x) => x.method));
  assert.deepEqual(TYPERT_REMOTE.descriptors.map((x) => x.method), INVOCATIONS.map((x) => x.method));
  let client;
  const script = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  vm.runInNewContext(script, {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'dsh-legal-casebench');
      client = factory((name) => {
        if (name === 'react') return { Component: class {} };
        if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
        throw new Error(`unexpected require: ${name}`);
      });
    } } },
  });
  assert.deepEqual(Array.from(client.INVOCATIONS, (x) => x.method), INVOCATIONS.map((x) => x.method));
  assert.deepEqual(Array.from(client.inject), ['remote', 'slots', 'sidebarRightTabs']);
  const { rowKey, stageLabel, fileAddress, roleLabel, statusLabel, kindLabel,
    authorityLabel, verificationLabel, versionLabel, dateLabel, errorLabel } = client.uiHelpers;
  assert.notEqual(rowKey('practice', { id: 'PN-000001', matter_id: 'same' }), rowKey('practice', { id: 'PN-000002', matter_id: 'same' }));
  assert.notEqual(rowKey('cases', { matter_id: 'same' }), rowKey('practice', { id: 'same' }));
  assert.equal(stageLabel('unknown'), '阶段待确认');
  assert.equal(stageLabel(''), '阶段待确认');
  assert.equal(stageLabel('first-instance'), '一审');
  assert.equal(stageLabel('second-instance'), '二审');
  assert.equal(stageLabel('retrial-review'), '再审审查');
  assert.equal(roleLabel('debtor'), '债务人');
  assert.equal(roleLabel('respondent-to-application'), '被申请人');
  assert.equal(roleLabel('restructuring-advisor', 'non-litigation'), '重组顾问');
  assert.equal(statusLabel('appeal-filed'), '已提起上诉');
  assert.equal(kindLabel('analysis'), '分析成果');
  assert.equal(kindLabel('final'), '定稿成果');
  assert.equal(authorityLabel('statute'), '法律规范');
  assert.equal(verificationLabel('partially_verified'), '部分核验');
  assert.equal(versionLabel('4.0.0-beta.1'), '4.0.0 测试版 1');
  assert.equal(dateLabel('2026-09-26T12:00:00Z'), '2026-09-26 12:00:00 +00:00');
  assert.equal(errorLabel(new Error('Network error')), '读取失败，请重新读取；如仍失败，请检查工作区配置。');
  assert.equal(errorLabel(new Error('成果文件路径越过案件目录。')), '成果文件路径越过案件目录。');
  for (const fn of [stageLabel, roleLabel, statusLabel, kindLabel, authorityLabel, verificationLabel]) {
    assert.ok(!/[A-Za-z]/.test(fn('new-unknown-code')));
    assert.equal(fn('中文自定义值'), '中文自定义值');
  }
  assert.equal(fileAddress('session-1', '/案件/意见 #1.md'), 'dsh-resource://file/session/session-1//%E6%A1%88%E4%BB%B6/%E6%84%8F%E8%A7%81%20%231.md');
  assert.throws(() => fileAddress('', '/file.md'), /选择一个会话/);
});

test('Bundle 的 Skill 来自 common 组装且含新的只读视图', async () => {
  const base = resolve(import.meta.dirname, '../dist/skill');
  const common = resolve(import.meta.dirname, '../../../skills/legal-case-bench/common');
  for (const relative of ['SKILL.md', 'scripts/casebench_view.py', 'scripts/practice.py', 'references/practice-library.md']) {
    assert.equal(await readFile(resolve(base, relative), 'utf8'), await readFile(resolve(common, relative), 'utf8'));
  }
});
