import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {streamServer, closeStreams} from './stream-fixture.mjs';

const workspace=fileURLToPath(new URL('../../',import.meta.url));
const artifacts=await mkdtemp(join(tmpdir(),'riflo-browser-'));
await mkdir(join(artifacts,'downloads'));
process.env.RIFLO_SMOKE_ARTIFACTS=artifacts;
const children=[];
const blocked=[];
let canaryHits=0;
const canary=createServer((_request,response)=>{canaryHits++;response.end('must not be reached');});
const socketCanary=createServer((_request,response)=>{canaryHits++;response.end('must not be reached');});
const denyProxy=createServer((request,response)=>{
  blocked.push(request.url);
  response.writeHead(403);response.end('Browser smoke blocks this destination.');
});
denyProxy.on('upgrade',(request,socket)=>{
  socket.on('error',()=>{});
  blocked.push(`UPGRADE ${request.url}`);
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});
denyProxy.on('connect',(request,socket)=>{
  socket.on('error',()=>{});
  blocked.push(`CONNECT ${request.url}`);
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});
await Promise.all([canary,socketCanary,denyProxy,streamServer].map(server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))));
process.env.RIFLO_SMOKE_SOCKET_CANARY=`ws://127.0.0.1:${socketCanary.address().port}/socket-canary`;
process.env.RIFLO_SMOKE_CANARY=`http://127.0.0.1:${canary.address().port}`;
// The browser and Vite receive only local test settings, never the parent's provider settings.
const childEnvironment=Object.fromEntries(['PATH','HOME','TMPDIR','JAVA_HOME','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
async function start(command,args,env={}) {
  const log=await open(join(artifacts,`${children.length}.log`),'w');
  const child=spawn(command,args,{cwd:workspace,env:{...childEnvironment,...env},stdio:['ignore',log.fd,log.fd],detached:true});
  children.push(child);
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
  await log.close();
}
async function ready(url) {
  for(let attempt=0;attempt<150;attempt++) {
    try {if((await fetch(url)).ok)return;}catch{}
    if(children.some(child=>child.exitCode!==null))throw Error(`A test process exited. Logs: ${artifacts}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(`Test service did not start: ${url}. Logs: ${artifacts}`);
}
try {
  for(const url of ['http://127.0.0.1:5188','http://127.0.0.1:9198','http://127.0.0.1:9248/json']) {
    try {await fetch(url);throw Error(`Test port already occupied: ${url}`)}catch(error){if(error.message.startsWith('Test port'))throw error;}
  }
  const config=join(artifacts,'firebase.json');
  await writeFile(config,JSON.stringify({emulators:{auth:{host:'127.0.0.1',port:9198},ui:{enabled:false},hub:{port:4458},logging:{port:4558}}}));
  await start('firebase',['emulators:start','--only','auth','--project','demo-riflo-browser','--config',config]);
  await start('npm',['run','dev','--','--host','127.0.0.1','--port','5188','--mode','smoke'],{
    VITE_GOOGLE_PICKER_API_KEY:(process.env.RIFLO_SMOKE_MOTION_ONLY==='1'||process.env.RIFLO_SMOKE_PROJECTS_ONLY==='1')?'local-fixture-key':'',VITE_GOOGLE_PROJECT_NUMBER:(process.env.RIFLO_SMOKE_MOTION_ONLY==='1'||process.env.RIFLO_SMOKE_PROJECTS_ONLY==='1')?'123456789':'',VITE_FIREBASE_API_KEY:'test-web-key',VITE_FIREBASE_AUTH_DOMAIN:'demo-riflo-browser.firebaseapp.com',VITE_FIREBASE_PROJECT_ID:'demo-riflo-browser',VITE_FIREBASE_APP_ID:'test-app',VITE_FIREBASE_AUTH_EMULATOR_URL:'http://127.0.0.1:9198',
  });
  const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await start(chrome,['--headless=new','--hide-scrollbars',`--proxy-server=http://127.0.0.1:${denyProxy.address().port}`,`--proxy-bypass-list=<-loopback>;127.0.0.1:5188;127.0.0.1:9198;127.0.0.1:${streamServer.address().port}`,'--disable-background-networking','--disable-quic','--disable-extensions','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--no-first-run','--no-default-browser-check','--remote-debugging-port=9248',`--user-data-dir=${join(artifacts,'chrome')}`,'about:blank']);
  await Promise.all([ready('http://127.0.0.1:5188'),ready('http://127.0.0.1:9198'),ready('http://127.0.0.1:9248/json')]);
  for(const path of ['/health','/v1/unhandled-smoke-route']) {
    const response=await fetch(`http://127.0.0.1:5188${path}`);
    assert.equal(response.status,503);
    assert.equal((await response.json()).error.code,'smoke_fixture_required');
  }
  await import(process.env.RIFLO_SMOKE_THEME_ONLY === '1' ? './theme-preview.mjs' : './flows.mjs');
  assert.equal(canaryHits,0,'No browser target may contact an unapproved server');
  assert.ok(blocked.some(url=>url===`${process.env.RIFLO_SMOKE_CANARY}/fetch-canary`),'Main-page request must reach only the deny proxy');
  assert.ok(blocked.some(url=>url===`${process.env.RIFLO_SMOKE_CANARY}/popup-canary`),'Popup request must reach only the deny proxy');
  assert.ok(blocked.some(url=>url===`CONNECT 127.0.0.1:${canary.address().port}`),'TLS requests must be refused by the deny proxy');
  assert.ok(blocked.some(url=>url.includes('/socket-canary')||url===`CONNECT 127.0.0.1:${socketCanary.address().port}`),'WebSocket requests must be refused by the deny proxy');
  await writeFile(join(artifacts,'network-isolation.json'),JSON.stringify({canaryHits,blocked},null,2));
  console.log(`Browser artifacts: ${artifacts}`);
} finally {
  for(const child of children.reverse()) {
    if(child.exitCode!==null)continue;
    try {process.kill(-child.pid,'SIGTERM')}catch{}
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);
    try {process.kill(-child.pid,'SIGKILL')}catch{}
  }
  await Promise.all([canary,socketCanary,denyProxy,streamServer].map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));
}
