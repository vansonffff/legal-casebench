/** 隔离 DSH_HOME，实际挂载插件并请求 Host 宣告的 Client bundle；令牌仅在内存使用。 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const existingProfile = process.argv.includes('--existing');
const home = existingProfile ? null : await mkdtemp(resolve(tmpdir(), 'casebench-dsh-probe-'));
const packageArg = process.argv.slice(2).find((arg) => arg !== '--existing');
const packageRoot = packageArg ? resolve(packageArg) : resolve(import.meta.dirname, '..');
const env = home ? { ...process.env, DSH_HOME: home } : { ...process.env };

async function command(binary, args) {
  return new Promise((done, fail) => {
    const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', fail);
    child.on('close', (code) => code === 0 ? done() : fail(new Error(`${binary} exit ${code}: ${stderr.slice(-500)}`)));
  });
}

let web;
try {
  if (!existingProfile) await command('dsh', ['plugin', '--profile', 'web', 'add', packageRoot]);
  const result = await new Promise((done, fail) => {
    web = spawn('dsh', ['web', '--no-open', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; fail(new Error(`boot timeout: ${stderr.slice(-500)}`)); } }, 30000);
    web.stdout.on('data', async (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const login = await fetch(match[0], { redirect: 'manual' });
        const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
        if (!cookie) throw new Error('测试实例未设置会话 Cookie');
        const origin = new URL(match[0]).origin;
        const page = await fetch(`${origin}/`, { headers: { cookie } });
        const html = await page.text();
        const link = html.match(/href="([^"]*dsh-legal-casebench\/client\.js[^"]*)"/);
        if (!link) throw new Error('Host boot manifest 未包含 CaseBench Client');
        const url = new URL(link[1].replaceAll('&amp;', '&'), `${origin}/`);
        const asset = await fetch(url, { headers: { cookie } });
        const script = await asset.text();
        done({ bootStatus: login.status, pageStatus: page.status, clientStatus: asset.status,
          registered: script.includes("id: 'dsh-legal-casebench'") && script.includes('案件工作台'),
          hostError: /(?:error|failed).*casebench/i.test(stderr) });
      } catch (error) { fail(error); }
    });
    web.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    web.on('error', fail);
    web.on('close', (code) => { if (!settled) { settled = true; clearTimeout(timer); fail(new Error(`DSH exited ${code}: ${stderr.slice(-500)}`)); } });
  });
  console.log(JSON.stringify(result));
  if (result.pageStatus !== 200 || result.clientStatus !== 200 || !result.registered || result.hostError) process.exitCode = 1;
} catch (error) {
  console.error(`CaseBench runtime probe failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  web?.kill('SIGTERM');
  if (home) await rm(home, { recursive: true, force: true });
}
