// Isolated production-bundle startup probe; no provider calls.
// node test/browser/startup.mjs [baseline-dist current-dist]
// Optional RIFLO_STARTUP_IDENTITY is a JSON local Auth-emulator signup response.
// Its token seeds SDK persistence; account lookup/API replies are local fixtures.
// RIFLO_STARTUP_DESKTOP=1 uses native Chrome UA. RIFLO_HELPER_DELAY_MS=0 removes the synthetic helper stall.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

const identityFixture = JSON.parse(process.env.RIFLO_STARTUP_IDENTITY || 'null');
const artifacts = await mkdtemp(join(tmpdir(), 'riflo-performance-'));
const roots = process.argv.slice(2).length ? process.argv.slice(2).map(path => resolve(path)) : [resolve('dist')];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
let root = roots[0];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://local').pathname;
    if(path==='/__seed'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Fixture seed</title>');return;}
    const relative = path.startsWith('/assets/') ? path.slice(1) : 'index.html';
    const target = resolve(root, relative);
    if (!target.startsWith(root + '/')) throw Error('Invalid asset path');
    const bytes = await readFile(target);
    const compress = /\.(html|css|js)$/.test(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)], 'Cache-Control': 'no-store', ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(compress ? gzipSync(bytes) : bytes);
  } catch { response.writeHead(404); response.end(); }
});
const blocked = []; const requests = [];
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
  socket.onmessage = event => { const value = JSON.parse(event.data); if(value.method==='Fetch.requestPaused') respond(value.params).catch(e=>{if(!e.message.includes('Invalid InterceptionId'))console.error(e)}); if(value.method==='Network.requestWillBeSent') requests.push({url:value.params.request.url, timestamp:value.params.timestamp, initiator:value.params.initiator.type}); if (value.id) { pending.get(value.id)?.(value); pending.delete(value.id); } };
  async function respond({requestId,request}) {
    if(request.url.startsWith('https://apis.google.com/')) { await sleep(Number(process.env.RIFLO_HELPER_DELAY_MS??2000)); await command('Fetch.failRequest',{requestId,errorReason:'Failed'}); return; }
    let data;
    if(request.url.includes('identitytoolkit.googleapis.com')) {
      await sleep(150);
      data={users:[{localId:identityFixture.localId,email:'startup-fixture@example.test',emailVerified:true,providerUserInfo:[],lastLoginAt:String(Date.now()),createdAt:String(Date.now())}]};
    } else {
      await sleep(150);
      const path=new URL(request.url).pathname;
      const formats=['x_posts','linkedin_posts','blogs','newsletters','carousels','short_videos'];
      if(path==='/v1/capabilities') data={subscription:{active:true,reason:'active',expiresAt:null},features:Object.fromEntries(formats.map(f=>[f,{available:true,reason:'active'}])),limits:null,services:{drive:{configured:true},intake:{configured:true},generation:{configured:true},sources:{drive:{configured:true},youtube:{configured:true}}}};
      else if(path==='/v1/drive/connection') data={configured:true,connected:true};
      else if(path==='/v1/projects') data=[{id:'startup_fixture',importOperationId:'startup_import',status:'source_ready',source:{fileId:'startup_video',name:'Startup fixture.mp4',bytes:50000000,durationSeconds:75},createdAt:'2026-10-18T00:00:00Z',sourceExpiresAt:'2030-01-01T00:00:00Z',errorCode:null}];
      else if(path.endsWith('/generation/availability')) data={sourceAvailable:true,transcriptAvailable:false,sourceExpiresAt:'2030-01-01T00:00:00Z',transcriptExpiresAt:null,activeBatch:false,outputs:Object.fromEntries(formats.map(f=>[f,{available:true,reason:'available'}])),access:{active:true,reason:'active',expiresAt:null},preferences:{languages:['English'],limits:{audience:1000,voice:1000,language:80,spelling:80}}};
      else if(path.endsWith('/outputs')) data=[];
      else if(path.endsWith('/generation')) data=null;
      else if(path==='/v1/projects/startup_fixture') data={id:'startup_fixture',importOperationId:'startup_import',status:'source_ready',source:{fileId:'startup_video',name:'Startup fixture.mp4',bytes:50000000,durationSeconds:75},createdAt:'2026-10-18T00:00:00Z',sourceExpiresAt:'2030-01-01T00:00:00Z',errorCode:null};
      else throw Error('Unexpected fixture '+path);
      data={data};
    }
    await command('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await command('Page.enable'); await command('Performance.enable'); if(process.env.RIFLO_STARTUP_DESKTOP!=='1') await command('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
  await command('Network.enable'); await command('Fetch.enable',{patterns:[{urlPattern:'https://apis.google.com/*'},{urlPattern:'https://identitytoolkit.googleapis.com/*'},{urlPattern:origin+'/v1/*'}]});
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  // Confirm the browser cannot bypass its deny proxy, including for localhost.
  await evaluate(`fetch('http://127.0.0.1:${canaryPort}/network-canary').catch(()=>null)`);
  assert.equal(canaryHits, 0);
  assert.ok(blocked.some(url => url.includes('/network-canary')));
  await command('Emulation.setCPUThrottlingRate', { rate: 4 });
  await command('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8 });
  // Record the first real route content independently of polling/Node scheduling.
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
window.__startup={};new PerformanceObserver(list=>{(window.__startup.longTasks??=[]).push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))}).observe({type:'longtask',buffered:true});
new MutationObserver(()=>{const s=window.__startup;
if(!s.shellMs&&document.querySelector('.studio-loading,.signin,#main'))s.shellMs=performance.now();
if(!s.authMs&&!document.querySelector('.studio-loading')&&document.querySelector('.signin .google-button:not(:disabled),.sidebar'))s.authMs=performance.now();
const newProject=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('New project')&&!b.disabled);
if(newProject&&!s.newProjectActionMs)s.newProjectActionMs=performance.now();
const ready=location.pathname==='/'?document.querySelector('.signin .google-button:not(:disabled)'):location.pathname==='/projects'?newProject&&document.querySelector('a.project-row[href="/projects/startup_fixture"]'):[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Create content')&&!b.disabled);
if(!window.__readyAt&&ready){window.__readyAt=performance.now();s.actionMs=window.__readyAt}
}).observe(document,{subtree:true,childList:true,attributes:true});` });
  const results = [];
  for (const candidate of roots) {
    root = candidate;
    const files = await readdir(join(root, 'assets'));
    const bundles = await Promise.all(files.filter(name => /\.(js|css)$/.test(name)).map(async name => { const bytes = await readFile(join(root, 'assets', name)); return { name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length }; }));
    const trials = [];
    for (const route of (identityFixture?['/projects','/projects/startup_fixture']:['/'])) {
      for (let trial = 1; trial <= 3; trial++) {
        await command('Network.clearBrowserCache');
        await command('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
        if(identityFixture) {
          assert.ok(identityFixture.idToken&&identityFixture.refreshToken&&identityFixture.localId,'Use a local Auth emulator signup response');
          await command('Page.navigate',{url:origin+'/__seed'}); await sleep(300);
          const entry=files.find(name=>name.startsWith('index-')&&name.endsWith('.js'));
          const source=await readFile(join(root,'assets',entry),'utf8');
          const apiKey=source.match(/VITE_FIREBASE_API_KEY:`([^`]+)`/)[1];
          const stored={uid:identityFixture.localId,email:'startup-fixture@example.test',emailVerified:true,isAnonymous:false,providerData:[],stsTokenManager:{refreshToken:identityFixture.refreshToken,accessToken:identityFixture.idToken,expirationTime:Date.now()+3600000},createdAt:String(Date.now()),lastLoginAt:String(Date.now()),apiKey,appName:'[DEFAULT]'};
          await evaluate(`localStorage.setItem(${JSON.stringify('firebase:authUser:'+apiKey+':[DEFAULT]')},${JSON.stringify(JSON.stringify(stored))})`);
          // Remove empty IndexedDB auth record so the SDK migrates the local persisted user.
          await evaluate(`new Promise(r=>{const q=indexedDB.deleteDatabase('firebaseLocalStorageDb');q.onsuccess=r;q.onerror=r;q.onblocked=r})`);
        }
        const requestStart=requests.length;
        const initialMetrics=await command('Performance.getMetrics');
        await evaluate('window.__readyAt=undefined'); await command('Page.navigate', { url: origin + route });
        let ready = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          try { ready = await evaluate(`location.href===${JSON.stringify(origin + route)}&&!!window.__readyAt`); } catch {}
          if (ready) break;
          await sleep(100);
        }
        assert.ok(ready, `Route renders: ${route}: ${ready?'':await evaluate('document.body.innerText')}`);
        await evaluate('document.fonts.ready');
        // Include delayed chunks/font loads, never stop counting at first content.
        await sleep(500);
        const measurement = await evaluate(`({readyMs:window.__readyAt,startup:window.__startup,resources:performance.getEntriesByType('resource').filter(x=>x.name.startsWith(location.origin)).map(x=>({path:new URL(x.name).pathname,startMs:x.startTime,endMs:x.responseEnd,transferBytes:x.transferSize,encodedBytes:x.encodedBodySize,decodedBytes:x.decodedBodySize})),document:performance.getEntriesByType('navigation').map(x=>({transferBytes:x.transferSize,encodedBytes:x.encodedBodySize}))[0]})`);
        const metrics=await command('Performance.getMetrics');
        trials.push({ route, trial, ...measurement, cpuMetrics:metrics.metrics.filter(x=>['ScriptDuration','TaskDuration'].includes(x.name)).map(x=>({...x,value:x.value-(initialMetrics.metrics.find(m=>m.name===x.name)?.value??0)})), requests:requests.slice(requestStart).map(r=>({url:r.url.replace(/key=[^&]+/g,'key=REDACTED'),startMs:1000*(r.timestamp-requests[requestStart].timestamp),initiator:r.initiator})), totalTransferBytes: measurement.resources.reduce((sum, item) => sum + item.transferBytes, measurement.document.transferBytes) });
      }
    }
    results.push({ label: root === resolve('dist') ? 'current' : 'baseline', bundles, trials });
  }
  assert.equal(canaryHits, 0);
  await writeFile(join(artifacts, 'performance.json'), JSON.stringify({ requests:requests.filter(r=>!r.url.includes('network-canary')).map(r=>({...r,url:r.url.replace(/key=[^&]+/g,'key=REDACTED')})), blocked:blocked.filter(x=>!x.includes('cup2')), conditions: { identity:!!identityFixture,userAgent:process.env.RIFLO_STARTUP_DESKTOP==='1'?'native Chrome':'iPhone Safari UA on Chrome (not Safari engine)',helperDelayMs:Number(process.env.RIFLO_HELPER_DELAY_MS??2000),apiFixtureDelayMs:150,cpu: 4, downloadBitsPerSecond: 1600000, latencyMs: 100, cache: 'disabled', trials: 3, note: 'Local gzip server and production bundles. UA and helper delay specified separately. SDK persisted-auth restore uses isolated emulator-issued token with mocked identity/API replies when enabled. Includes document and observed assets; no production/Safari-engine latency claim.' }, canaryHits, blockedCount: blocked.length, results }, null, 2));
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
