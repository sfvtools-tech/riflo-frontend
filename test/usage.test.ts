import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readUsage, allowanceAmount, allowanceLabels} from '../src/features/account/usage-response.ts';
const counts=Object.fromEntries(allowanceLabels.map(([key])=>[key,10]));
const usage={startsAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00.000Z',limits:counts,consumed:{...counts,sourceSeconds:1.25},reserved:counts,remaining:{...counts,x_posts:3}};
test('usage keeps backend balances and fractional source time without inferring billing',()=>{
 assert.deepEqual(readUsage(usage),usage);
 assert.equal(readUsage(usage).remaining.x_posts,3);
 assert.equal(allowanceAmount('sourceSeconds',125.25),'2m 5.25s');
 assert.equal(allowanceAmount('sourceSeconds',0),'0m');
});
test('usage rejects impossible periods and missing, negative or nonfinite allowance values',()=>{
 for(const change of [{startsAt:'2026-02-30T00:00:00Z'},{expiresAt:usage.startsAt},{startsAt:'2027-01-01T00:00:00Z'},{startsAt:null},{expiresAt:'2026-11-01'}])assert.throws(()=>readUsage({...usage,...change}));
 for(const field of ['limits','consumed','reserved','remaining'])for(const value of [null,[],{}, {...counts,x_posts:-1},{...counts,sourceSeconds:Infinity},{...counts,blogs:'10'}])assert.throws(()=>readUsage({...usage,[field]:value}));
});
