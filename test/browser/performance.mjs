// Production assets only; no provider calls. Usage: node test/browser/performance.mjs [dist ...]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

const artifacts = await mkdtemp(join(tmpdir(), 'riflo-performance-'));
const roots = process.argv.slice(2).length ? process.argv.slice(2).map(path => resolve(path)) : [resolve('dist')];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
let root = roots[0];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://local').pathname;
    const relative = path.startsWith('/assets/') ? path.slice(1) : 'index.html';
    const target = resolve(root, relative);
    if (!target.startsWith(root + '/')) throw Error('Invalid asset path');
    const bytes = await readFile(target);
    const compress = /\.(html|css|js)$/.test(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)], 'Cache-Control': 'no-store', ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(compress ? gzipSync(bytes) : bytes);
  } catch { response.writeHead(404); response.end(); }
});
const blocked = [];
const proxy = createServer((request, response) => { blocked.push(request.url); response.writeHead(403); response.end(); });
proxy.on('connect', (request, socket) => { blocked.push(request.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
const canary = createServer((_, response) => { canaryHits++; response.end(); });
let canaryHits = 0;
const port = await listen(server), proxyPort = await listen(proxy), canaryPort = await listen(canary);
const origin = `http://127.0.0.1:${port}`;
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(artifacts, 'chrome')}`,
  `--proxy-server=http://127.0.0.1:${proxyPort}`, `--proxy-bypass-list=<-loopback>;127.0.0.1:${port}`,
  '--disable-background-networking', '--disable-quic', '--disable-extensions', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
let socket;
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = (await readFile(join(artifacts, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await sleep(100); }
  }
  assert.ok(debugPort, 'Chrome starts');
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.onopen = resolve);
  let sequence = 0;
  const pending = new Map();
  function command(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 20000);
      pending.set(id, value => { clearTimeout(timer); value.error ? reject(Error(JSON.stringify(value.error))) : resolve(value.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.onmessage = event => { const value = JSON.parse(event.data); if (value.id) { pending.get(value.id)?.(value); pending.delete(value.id); } };
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await command('Page.enable');
  await command('Network.enable');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  // Confirm the browser cannot bypass its deny proxy, including for localhost.
  await evaluate(`fetch('http://127.0.0.1:${canaryPort}/network-canary').catch(()=>null)`);
  assert.equal(canaryHits, 0);
  assert.ok(blocked.some(url => url.includes('/network-canary')));
  await command('Emulation.setCPUThrottlingRate', { rate: 4 });
  await command('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8 });
  // Record the first real route content independently of polling/Node scheduling.
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `new MutationObserver(()=>{if(!window.__readyAt&&(document.querySelector('.signin .google-button')||document.querySelector('#main h1'))){window.__readyAt=performance.now()}}).observe(document,{subtree:true,childList:true});` });
  const results = [];
  for (const candidate of roots) {
    root = candidate;
    const files = await readdir(join(root, 'assets'));
    const bundles = await Promise.all(files.filter(name => /\.(js|css)$/.test(name)).map(async name => { const bytes = await readFile(join(root, 'assets', name)); return { name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length }; }));
    const trials = [];
    for (const route of ['/', '/projects?preview=true', '/projects/sample?preview=true', '/settings?preview=true']) {
      for (let trial = 1; trial <= 3; trial++) {
        await command('Network.clearBrowserCache');
        await command('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
        await command('Page.navigate', { url: origin + route });
        let ready = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          try { ready = await evaluate(`location.href===${JSON.stringify(origin + route)}&&!!window.__readyAt`); } catch {}
          if (ready) break;
          await sleep(100);
        }
        assert.ok(ready, `Route renders: ${route}`);
        await evaluate('document.fonts.ready');
        // Include delayed chunks/font loads, never stop counting at first content.
        await sleep(500);
        const measurement = await evaluate(`({readyMs:window.__readyAt,resources:performance.getEntriesByType('resource').filter(x=>x.name.startsWith(location.origin)).map(x=>({path:new URL(x.name).pathname,transferBytes:x.transferSize,encodedBytes:x.encodedBodySize,decodedBytes:x.decodedBodySize})),document:performance.getEntriesByType('navigation').map(x=>({transferBytes:x.transferSize,encodedBytes:x.encodedBodySize}))[0]})`);
        trials.push({ route, trial, ...measurement, totalTransferBytes: measurement.resources.reduce((sum, item) => sum + item.transferBytes, measurement.document.transferBytes) });
      }
    }
    results.push({ label: root === resolve('dist') ? 'current' : 'baseline', bundles, trials });
  }
  assert.equal(canaryHits, 0);
  await writeFile(join(artifacts, 'performance.json'), JSON.stringify({ conditions: { cpu: 4, downloadBitsPerSecond: 1600000, latencyMs: 100, cache: 'disabled', trials: 3, note: 'Local gzip server, cold signed-out/preview routes only. Includes document and all observed assets. No production latency claim.' }, canaryHits, blockedCount: blocked.length, results }, null, 2));
  console.log(`Performance evidence: ${join(artifacts, 'performance.json')}`);
  for (const result of results) for (const route of [...new Set(result.trials.map(x => x.route))]) {
    const trials = result.trials.filter(x => x.route === route);
    console.log(JSON.stringify({ label: result.label, route, medianReadyMs: trials.map(x => x.readyMs).sort((a,b) => a-b)[1], transferBytes: trials.map(x => x.totalTransferBytes) }));
  }
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), sleep(2000)]);
  if (chrome.exitCode === null) chrome.kill('SIGKILL');
  await Promise.all([server, proxy, canary].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
}
