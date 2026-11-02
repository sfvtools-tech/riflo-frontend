import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const artifacts=process.env.RIFLO_SMOKE_ARTIFACTS;
const pages=await (await fetch('http://127.0.0.1:9248/json')).json();
const socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
await new Promise(resolve=>socket.onopen=resolve);
let sequence=0;
const pending=new Map();
const commands=[];
function command(method,params={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command stalled: ${method}`))},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject,method});
    socket.send(JSON.stringify({id,method,params}));
  });
}
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function evaluate(expression) {
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(text,attempts=120) {
  for(let attempt=0;attempt<attempts;attempt++) {
    if((await evaluate('document.body?.innerText ?? ""')).includes(text))return;
    await sleep(50);
  }
  throw Error(`Missing ${text}: ${await evaluate('document.body.innerText')}`);
}
async function waitUntil(expression,description) {
  for(let attempt=0;attempt<120;attempt++) {
    if(await evaluate(expression))return;
    await sleep(50);
  }
  throw Error(`Missing ${description}`);
}
async function click(text) {
  await waitFor(text);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes(${JSON.stringify(text)})).click()`);
}
async function navigate(path) {
  await command('Page.navigate',{url:`http://127.0.0.1:5188${path}`});
}
async function capture(name) {
  const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(join(artifacts,`${name}.png`),Buffer.from(screenshot.data,'base64'));
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${name}: horizontal page overflow`);
}
socket.onmessage=({data})=>{
  const message=JSON.parse(data);
  if(message.id) {
    const waiting=pending.get(message.id);
    if(waiting){pending.delete(message.id);message.error?waiting.reject(Error(`${waiting.method}: ${message.error.message}`)):waiting.resolve(message.result);}
  }
};
try {
  await navigate('/projects');await sleep(500);
  await evaluate(`fetch(${JSON.stringify(process.env.RIFLO_SMOKE_CANARY+'/fetch-canary')}).catch(()=>undefined)`);
  assert.equal(await evaluate(`window.__canaryPopup=window.open(${JSON.stringify(process.env.RIFLO_SMOKE_CANARY+'/popup-canary')},'isolation-canary');Boolean(window.__canaryPopup)`),true);
  await sleep(300);
  await evaluate('window.__canaryPopup.close()');
  await evaluate(`fetch(${JSON.stringify(process.env.RIFLO_SMOKE_CANARY.replace('http:','https:')+'/tls-canary')}).catch(()=>undefined)`);
  await evaluate(`new Promise((resolve,reject)=>{const socket=new WebSocket(${JSON.stringify(process.env.RIFLO_SMOKE_SOCKET_CANARY)});socket.onerror=()=>resolve();socket.onopen=()=>{socket.close();reject(Error('Unapproved WebSocket connected'));};setTimeout(()=>{socket.close();reject(Error('WebSocket isolation check stalled'));},2000);})`);
  await (await import('./theme.mjs')).checkTheme({command,evaluate,navigate,waitFor,waitUntil,capture,signedOut:true});
  console.log('PASS: focused neutral appearance suite');
} finally { socket.close(); }
