/** 使用桌面 app 的真实分发件隔离启动；不读取用户配置、凭据或案件。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const executable = process.env.CASEBENCH_DESKTOP_EXECUTABLE || '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
const runtime = process.env.CASEBENCH_DESKTOP_RUNTIME || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh';
const python = process.env.CASEBENCH_PYTHON || `${process.env.HOME}/.local/bin/python3.12`;
const home = await mkdtemp(resolve(tmpdir(), 'casebench-native-'));
const profileDir = resolve(home, 'profiles/web');
const fixture = resolve(home, 'workspace');
const packageRoot = resolve(import.meta.dirname, '..');
let child;
try {
  await mkdir(resolve(profileDir, 'node_modules'), { recursive: true });
  await mkdir(fixture);
  await symlink(packageRoot, resolve(profileDir, 'node_modules/dsh-legal-casebench'));
  await writeFile(resolve(profileDir, 'package.json'), JSON.stringify({ name: 'casebench-native-probe', private: true,
    dependencies: { 'dsh-legal-casebench': `link:${packageRoot}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-legal-casebench'] } } }));
  await writeFile(resolve(profileDir, 'cordis.patch.yml'), `- id: legal-casebench\n  config:\n    root: ${JSON.stringify(fixture)}\n    python: ${JSON.stringify(python)}\n`);
  const bootstrap = resolve(home, 'boot.mjs');
  await writeFile(bootstrap, `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const runtime = ${JSON.stringify(runtime)};
const { loadProfileDirectory, loadLayeredEnv } = await import(runtime + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js');
const { runProfile } = await import(runtime + '/node_modules/@deepseek-ai/dsh/lib/profile-boot.js');
const { agentEvents } = await import(runtime + '/node_modules/@deepseek-ai/dsh-agent/lib/index.js');
const anchor = runtime + '/node_modules/@deepseek-ai/dsh/package.json';
const profile = loadProfileDirectory('dsh', ${JSON.stringify(profileDir)}, anchor);
assert.equal(profile.skippedBundles.length, 0, JSON.stringify(profile.skippedBundles));
const application = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'web', resolvedProfile: { profile, installAnchor: anchor }, patchFiles: [], args: ['--no-open', '--port', '0'] });
const ctx = application.ctx;
try {
  const service = ctx.get('casebench');
  assert.ok(service, 'CaseBench 服务未激活');
  const status = await service.remoteStatus();
  assert.equal(status.coreVersion, JSON.parse(await readFile(${JSON.stringify(resolve(packageRoot, 'package.json'))}, 'utf8')).version);
  const run = (...args) => {
    const r = spawnSync(${JSON.stringify(python)}, args, { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  };
  const scripts = ${JSON.stringify(resolve(packageRoot, 'dist/skill/scripts'))};
  run(scripts + '/matter.py', 'init', '--root', ${JSON.stringify(fixture)}, '--name', '隔离案件', '--actor', 'dsh');
  const matterPath = ${JSON.stringify(resolve(fixture, '隔离案件'))};
  run(scripts + '/issue.py', 'add', '--case-dir', matterPath, '--title', '隔离争点', '--actor', 'dsh');
  const session = ctx.sessions.prepare('casebench-native-session', { meta: { cwd: matterPath } });
  const detach = ctx.sessions.enter(session);
  const following = await service.remoteFollowSession({ sessionId: session.id });
  assert.equal(following.status, 'ready');
  const snap = await service.remoteQuoteIssue({ sessionId: session.id, matterPath, matterId: following.context.matter.id,
    issueId: 'ISS-0001', expectedHash: following.context.state_hash });
  assert.equal(snap.issue.title, '隔离争点');
  const payload = encodeURIComponent(JSON.stringify({ matterId: snap.matter.id, matterPath: snap.matter.path,
    issueId: snap.issue.issue_id, expectedHash: snap.state_hash }));
  const user = { id: 'probe-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '【案件引用：展示别名 · ISS-0001 · 隔离争点 · v2:' + payload + '】' }] };
  // 使用 AgentLoop 同一派发器与正常 enter 终端决策，无模型请求。
  const dispatch = agentEvents(ctx, { id: session.id, session });
  const expanded = await dispatch.waterfall('agent/pre-step', { messages: [user] },
    async () => ({ kind: 'enter', messages: [user] }));
  assert.equal(expanded.messages.length, 2);
  assert.ok(expanded.messages[1].content[0].text.includes('隔离争点'));
  session.append('user/message', user, { surfaceOp: 'append' });
  session.append('user/message', expanded.messages[1], { surfaceOp: 'append' });
  const fromSent = await service.remoteFollowSession({ sessionId: session.id });
  assert.equal(fromSent.source, 'reference');
  const loginUrl = ctx.connection.authenticatedUrl('http://127.0.0.1:' + ctx.webServer.port);
  const login = await fetch(loginUrl, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, '隔离实例没有认证 Cookie');
  const origin = new URL(loginUrl).origin;
  const page = await fetch(origin + '/', { headers: { cookie } });
  const html = await page.text();
  const link = html.match(/href="([^\"]*dsh-legal-casebench\\/client\\.js[^\"]*)"/);
  assert.ok(link, 'Host 未宣告 CaseBench Client');
  const client = await fetch(new URL(link[1].replaceAll('&amp;', '&'), origin), { headers: { cookie } });
  const clientText = await client.text();
  assert.ok(clientText.includes('followSession') && clientText.includes('恢复跟随会话'));
  const dshVersion = JSON.parse(await readFile(anchor, 'utf8')).version;
  detach();
  process.send?.({ ok: true, dshVersion, coreVersion: status.coreVersion, activation: true, followWorkspace: true,
    followSentReference: true, quoteChecked: true, expansionOnRealHost: true, pageStatus: page.status,
    clientStatus: client.status, newClientServed: true, browserMounted: false });
} finally { await application.shutdown.shutdown(0); }
`);
  const result = await new Promise((done, fail) => {
    child = spawn(executable, ['--expose-internals', bootstrap], { cwd: home,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let diagnostic = '', settled = false;
    const timer = setTimeout(() => { fail(new Error('隔离原生 Host 启动超时')); child.kill('SIGTERM'); }, 45000);
    child.stderr.on('data', (chunk) => { diagnostic += chunk.toString(); });
    child.stdout.resume(); // 不输出临时令牌。
    child.on('message', (message) => { settled = true; clearTimeout(timer); done(message); });
    child.on('error', (error) => { clearTimeout(timer); fail(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) fail(new Error(`隔离 Host exit ${code}: ${diagnostic.slice(-2000).replace(/token=[^\s]+/g, 'token=[省略]')}`));
    });
  });
  console.log(JSON.stringify(result));
  assert.equal(result.ok, true);
} finally {
  if (child?.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((done) => { child.once('close', done); setTimeout(done, 3000); });
  }
  await rm(home, { recursive: true, force: true });
}
