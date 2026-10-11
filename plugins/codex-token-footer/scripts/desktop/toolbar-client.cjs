'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const {spawn, spawnSync} = require('node:child_process');
const {setTimeout: pause} = require('node:timers/promises');
const {connect} = require('./cdp.cjs');
const {DatabaseSync} = require('node:sqlite');
const {readTurnUsage, formatFooter} = require('../token-footer.cjs');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const home = path.join(codexHome, 'token-toolbar');
const runtimeFile = path.join(home, 'runtime.json');
function powershell(source) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source],
    {encoding: 'utf8', windowsHide: true, timeout: 15000});
  if (result.status !== 0) throw new Error((result.stderr || 'PowerShell failed').trim());
  return result.stdout.trim().replace(/^\uFEFF/, '');
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function targetsAt(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)});
  if (!response.ok) throw new Error('UI debugger unavailable');
  return response.json();
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function foreground(pid) {
  powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TokenToolbarWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'; $p = Get-Process -Id ${Number(pid)} -ErrorAction Stop; if ($p.MainWindowHandle -ne 0) { [void][TokenToolbarWindow]::ShowWindow($p.MainWindowHandle,9); [void][TokenToolbarWindow]::SetForegroundWindow($p.MainWindowHandle) }`);
}
async function main() {
  fs.mkdirSync(home, {recursive:true});
  const args = process.argv.slice(2);
  const arg = name => args[args.indexOf(name) + 1];
  let previousApp;
  if (!args.includes('--attach') && fs.existsSync(runtimeFile)) {
    const previous = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    if (alive(previous.helperPid) && alive(previous.appPid)) {
      foreground(previous.appPid);
      console.log('Existing toolbar client opened.');
      return;
    }
    if (alive(previous.appPid)) {
      try { await targetsAt(previous.port); previousApp = previous; }
      catch { /* The previous app is not exposing this launcher’s debugger. */ }
    }
  }
  let port, appPid;
  if (args.includes('--attach')) {
    port = Number(arg('--attach'));
    appPid = Number(arg('--pid'));
  } else if (previousApp) {
    port = previousApp.port;
    appPid = previousApp.appPid;
    foreground(appPid);
  } else {
    const executable = powershell("$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; if(-not $p){throw 'Codex package missing'}; Join-Path $p.InstallLocation 'app\\ChatGPT.exe'");
    port = await freePort();
    const profile = path.join(home, 'profile');
    const child = spawn(executable, ['--lang=zh-CN', `--user-data-dir=${profile}`,
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`],
      {detached: true, stdio: 'ignore', windowsHide: true});
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    appPid = child.pid;
    child.unref();
  }
  const script = fs.readFileSync(path.join(__dirname, 'token-toolbar.js'), 'utf8');
  const clients = new Map();
  const usageCache = new Map();
  let databases;
  const databaseDeadline = Date.now() + 60000;
  do {
    databases = fs.readdirSync(codexHome).filter(name => /^state_\d+\.sqlite$/.test(name))
      .sort((a,b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    if (databases.length || !alive(appPid)) break;
    await pause(1000);
  } while (Date.now() < databaseDeadline);
  if (!databases.length) throw new Error('Codex conversation database missing; open Codex once before using the toolbar.');
  const threadDb = new DatabaseSync(path.join(codexHome, databases[0]), {readOnly:true});
  const findTranscript = threadDb.prepare('SELECT rollout_path FROM threads WHERE id=?');
  const state = {helperPid: process.pid, appPid, port, injected: false, profileIsSeparate: true};
  fs.writeFileSync(runtimeFile, JSON.stringify(state, null, 2));
  const deadline = Date.now() + 60000;
  try {
    while (alive(appPid)) {
      let targets;
      try { targets = await targetsAt(port); }
      catch (error) {
        if (!state.injected && Date.now() > deadline) throw error;
        await pause(1500); continue;
      }
      const pages = targets.filter(target => target.url.startsWith('app://') && target.webSocketDebuggerUrl);
      const ids = new Set(pages.map(target => target.id));
      for (const [id, client] of clients) if (!ids.has(id)) { client.close(); clients.delete(id); }
      for (const target of pages) {
        if (clients.has(target.id)) continue;
        const client = connect(target.webSocketDebuggerUrl);
        try {
          await client.send('Page.enable');
          await client.send('Page.addScriptToEvaluateOnNewDocument', {source: script});
          const result = await client.send('Runtime.evaluate', {expression: script, returnByValue: true});
          if (result.exceptionDetails) throw new Error('Toolbar injection failed');
          clients.set(target.id, client);
          state.injected = true;
          fs.writeFileSync(runtimeFile, JSON.stringify(state, null, 2));
          console.log('Token toolbar attached to the real Codex page.');
        } catch (error) { client.close(); console.error(error.message); }
      }
      for (const client of clients.values()) {
        try {
          const wanted = await client.send('Runtime.evaluate', {
            expression:'window.__codexTokenToolbar?.pending?.() || []', returnByValue:true
          });
          const entries = [];
          for (const turn of wanted.result.value || []) {
            const transcript = findTranscript.get(turn.threadId)?.rollout_path;
            if (!transcript || !fs.existsSync(transcript)) continue;
            const stamp = fs.statSync(transcript).mtimeMs;
            const key = turn.threadId + '/' + turn.turnId;
            let cached = usageCache.get(key);
            if (!cached || cached.stamp !== stamp) {
              const usage = await readTurnUsage(transcript, turn.turnId);
              cached = {stamp, message:usage.status === 'ok' ? formatFooter(usage) : null};
              usageCache.set(key, cached);
            }
            if (cached.message) entries.push({...turn, message:cached.message});
          }
          if (entries.length) await client.send('Runtime.evaluate', {
            expression:'window.__codexTokenToolbar?.setLogStats(' + JSON.stringify(entries) + ')'
          });
        } catch (error) { console.error('Local token statistics: ' + error.message); }
      }
      if (!state.injected && Date.now() > deadline) throw new Error('No Codex UI target appeared');
      await pause(1500);
    }
  } finally {
    threadDb.close();
    for (const client of clients.values()) client.close();
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
