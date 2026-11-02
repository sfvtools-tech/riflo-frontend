import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Mount the real component with real React effects and a canonical API seam.
// Only long native timers are controlled; UI tasks still run on the browser clock.
export async function checkSourceExpiry({evaluate,waitUntil}) {
  try {
    await evaluate(`(async()=>{
      const reactModule=await import('/node_modules/.vite/deps/react.js');
      const React=reactModule.default??reactModule;
      const domModule=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {createRoot}=domModule.default??domModule;
      const {LiveProjectDetail}=await import('/src/features/projects/LiveProjectDetail.tsx');
      const {SessionProvider,useSession}=await import('/src/shared/auth/session.tsx');
      const cap=2147483647,start=Date.now(),expires=start+60*86400000;
      const timers=new Map(),delays=[],reads=[];
      const native={now:Date.now,setTimeout:window.setTimeout,clearTimeout:window.clearTimeout};
      let clock=start,serial=0;
      const project={id:'detail_fixture',status:'source_ready',source:{fileId:'clock_source',name:'Controlled paid source',bytes:9,durationSeconds:30},createdAt:new Date(start).toISOString(),sourceExpiresAt:new Date(expires).toISOString(),errorCode:null};
      let cached=project;
      const api=async path=>{cached={...project,status:clock>=expires?'source_expired':'source_ready'};reads.push({path,at:clock,status:cached.status,expiresAt:cached.sourceExpiresAt});return cached};
      api.snapshot=(_path,read)=>read(cached);
      const host=document.createElement('div');host.id='source-clock-probe';document.body.append(host);
      const errors=[];const root=createRoot(host,{onUncaughtError:error=>errors.push(String(error))});
      window.__sourceClock={cap,start,expires,timers,delays,reads,errors,fire(){const [id,timer]=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0]??[];if(!timer)throw Error('No capped source timer remains');timers.delete(id);clock=timer.at;timer.callback()},cleanup(){root.unmount();host.remove();Date.now=native.now;window.setTimeout=native.setTimeout;window.clearTimeout=native.clearTimeout;timers.clear()}};
      Date.now=()=>clock;
      window.setTimeout=(callback,delay,...args)=>{if(delay<86400000)return native.setTimeout.call(window,callback,delay,...args);const id=--serial;delays.push(delay);timers.set(id,{at:clock+delay,callback:()=>callback(...args)});return id};
      window.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else native.clearTimeout.call(window,id)};
      function Probe(){const{user}=useSession();return user?React.createElement(LiveProjectDetail,{api,children:value=>React.createElement('output',{'data-source-clock':value.status},value.status)}):null}
      root.render(React.createElement(SessionProvider,null,React.createElement(Probe)));
    })()`);
    await waitUntil(`window.__sourceClock.reads.length===1&&window.__sourceClock.timers.size===1`,'initial 60-day source timer');
    for(let page=1;page<=2;page++) {
      await evaluate(`window.__sourceClock.fire()`);
      await waitUntil(`window.__sourceClock.reads.length===${page+1}&&window.__sourceClock.timers.size===1`,'capped source timer rearmed after unchanged canonical read');
      assert.equal(await evaluate(`window.__sourceClock.delays.at(-1)<=window.__sourceClock.cap`),true);
      assert.equal(await evaluate(`document.querySelector('[data-source-clock]').dataset.sourceClock`),'source_ready');
    }
    await evaluate(`window.__sourceClock.fire()`);
    await waitUntil(`document.querySelector('[data-source-clock]')?.dataset.sourceClock==='source_expired'&&window.__sourceClock.reads.length===4`,'canonical source expiry after 60 days');
    const evidence=await evaluate(`({start:window.__sourceClock.start,expires:window.__sourceClock.expires,delays:window.__sourceClock.delays,reads:window.__sourceClock.reads,timers:window.__sourceClock.timers.size,status:document.querySelector('[data-source-clock]').dataset.sourceClock})`);
    assert.deepEqual(evidence.delays,[2147483647,2147483647,60*86400000-2*2147483647+50]);
    assert.equal(evidence.reads.at(-1).at,evidence.expires+50);
    assert.equal(evidence.timers,0);
    assert.ok(evidence.reads.every(read=>read.expiresAt===new Date(evidence.expires).toISOString()),'canonical expiry stays unchanged through all reads');
    await writeFile(join(process.env.RIFLO_SMOKE_ARTIFACTS,'source-expiry-checks.json'),JSON.stringify(evidence,null,2));
    console.log('PASS: actual LiveProjectDetail rearms both native timer caps and canonically refreshes at its 60-day source expiry.');
  } catch(error) {
    console.error('Source clock probe diagnostics:',await evaluate(`window.__sourceClock?({reads:window.__sourceClock.reads,delays:window.__sourceClock.delays,timers:window.__sourceClock.timers.size,errors:window.__sourceClock.errors,html:document.querySelector('#source-clock-probe')?.innerHTML}):null`));
    throw error;
  } finally { await evaluate(`window.__sourceClock?.cleanup();delete window.__sourceClock`); }
}
