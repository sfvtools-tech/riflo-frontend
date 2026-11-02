import {createServer} from 'node:http';

// Test-only HTTP byte transport. API fixtures still own all canonical saved state.
const replies = new Map();
const connections = new Set();
const routes = new Map();
let sequence = 0;
export const streamEvidence = [];
export const streamServer = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5188');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  const reply = replies.get(request.url);
  replies.delete(request.url);
  if (!reply) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-store, no-transform', 'X-Accel-Buffering':'no'});
  response.flushHeaders();
  const evidence = {path:reply.path, method:request.method, chunks:[], closed:false};
  streamEvidence.push(evidence);
  connections.add(response);
  routes.set(reply.path,response);
  response.fixturePending=[];
  response.fixtureReady=false;
  const bytes = Buffer.from(reply.frames);
  const cuts = [1, 7, 19, bytes.length];
  let offset = 0;
  const write = () => {
    const end = cuts.shift();
    if (end === undefined || response.destroyed) return;
    const chunk = bytes.subarray(offset, end); offset=end;
    response.write(chunk); evidence.chunks.push(chunk.length);
    if (cuts.length) timer=setTimeout(write, 20);
    else {
      response.fixtureReady=true;
      for(const notify of response.fixturePending)notify();
      response.fixturePending=[];
      if (!reply.hold) response.end();
    }
  };
  let timer=setTimeout(write, 10);
  response.on('close', () => { clearTimeout(timer); connections.delete(response); if(routes.get(reply.path)===response)routes.delete(reply.path); evidence.closed=true; });
});
export function streamReply(path, frames, hold=false) {
  const token=`/stream-${++sequence}`;
  replies.set(token, {path, frames, hold});
  return `http://127.0.0.1:${streamServer.address().port}${token}`;
}
export function closeStreams() { for (const response of connections) response.end(); }
export function eventFrame(event, operation, detail={}) {
  return `event: ${event}\r\ndata: ${JSON.stringify({version:1,operation,...detail})}\r\n\r\n`;
}

export function notifyStream(path, frames, end=false) {
  const response=routes.get(path);
  if(!response)throw Error(`No open fixture stream: ${path}`);
  const notify=()=>{if(response.destroyed)return;response.write(frames);if(end)response.end();};
  if(response.fixtureReady)notify();else response.fixturePending.push(notify);
}
