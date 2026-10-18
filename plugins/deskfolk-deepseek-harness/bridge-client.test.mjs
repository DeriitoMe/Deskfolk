import test from 'node:test';
import assert from 'node:assert/strict';
import { createSender, postToPet } from './bridge-client.mjs';

test('client validates the rotating local bridge and never accepts arbitrary remote endpoints', async () => {
  const env = { PET_USER_DATA: 'D:/fixture' }, token = 'a'.repeat(64), seen = [];
  const run = bridge => postToPet({ event: 'snapshot' }, { env,
    read: async () => JSON.stringify(bridge),
    fetchImpl: async (url, options) => { seen.push({ url, options }); return { ok: true }; },
  });
  assert.equal(await run({ port: 12345, token, host: 'https://untrusted.test' }), true);
  assert.equal(seen[0].url, 'http://127.0.0.1:12345/deepseek-harness');
  assert.equal(seen[0].options.headers.authorization, 'Bearer ' + token);
  for (const invalid of [{port:0,token},{port:65536,token},{port:12345,token:'bad'}]) assert.equal(await run(invalid), false);
  assert.equal(seen.length, 1);
  assert.equal(await postToPet({}, {env:{}}), false);
});

test('closed or failed pet delivery is best effort', async () => {
  assert.equal(await postToPet({}, { env: {PET_USER_DATA:'fixture'}, read: async () => {throw new Error('offline');} }), false);
  assert.equal(await postToPet({}, { env:{PET_USER_DATA:'fixture'}, read:async()=>JSON.stringify({port:12345,token:'b'.repeat(64)}),
    fetchImpl:async()=>{throw new Error('offline');} }), false);
});

test('nonblocking bounded sender retains FIFO and discards stale queued notifications', async () => {
  let release, now = 1000;
  const sent = [];
  const sender = createSender({limit:2,now:()=>now,post: async body => {
    sent.push(body.sequence);
    if(body.sequence===1)await new Promise(resolve=>{release=resolve;});
    return true;
  }});
  for(let sequence=1;sequence<=4;sequence++)sender.send({sequence,time:now});
  assert.deepEqual(sent,[1]); release(); await new Promise(setImmediate);
  assert.deepEqual(sent,[1,3,4]);
  now=20_000;sender.send({sequence:5,time:1000});await new Promise(setImmediate);
  assert.deepEqual(sent,[1,3,4]);sender.close();sender.send({sequence:6,time:now});
  assert.deepEqual(sent,[1,3,4]);
});
