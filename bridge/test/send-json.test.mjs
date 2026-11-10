import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {sendJson} from '../agent/send-json.mjs';

import {WebSocket, WebSocketServer} from 'ws';

async function pair(t) {
  const server = new WebSocketServer({port: 0, host: '127.0.0.1'});
  await once(server, 'listening');
  const connected = once(server, 'connection');
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const [peer] = await connected;
  await once(client, 'open');
  t.after(async () => {
    client.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  return {client, peer};
}

function pace(client, delay = 3) {
  const original = client.send.bind(client);
  const frames = [];
  client.send = (data, options, callback) => {
    frames.push({bytes: Buffer.byteLength(data), ...options});
    original(data, options, error => setTimeout(() => callback(error), delay));
  };
  return frames;
}

test('concurrent JSON messages retain order, UTF-8, and text framing', async t => {
  const {client, peer} = await pair(t);
  const frames = pace(client, 1);
  const expected = [
    {type: 'result', id: 'one', text: '截图🖥️'.repeat(20000)},
    {type: 'health', ok: true},
    {type: 'result', id: 'two', text: 'b'.repeat(70000)}
  ];
  const received = [];
  const complete = new Promise(resolve => peer.on('message', (data, binary) => {
    assert.equal(binary, false);
    received.push(JSON.parse(data.toString()));
    if (received.length === expected.length) resolve();
  }));
  assert.deepEqual(await Promise.all(expected.map(message => sendJson(client, message))), [true, true, true]);
  await complete;
  assert.deepEqual(received, expected);
  assert.ok(frames.length > 3);
  assert.ok(frames.every(frame => frame.bytes <= 16384 && frame.binary === false));
  assert.equal(frames.filter(frame => frame.fin).length, expected.length);
});

test('ping/pong completes during a paced screenshot transfer', async t => {
  const {client, peer} = await pair(t);
  pace(client);
  let completed = false;
  let pongsBeforeCompletion = 0;
  peer.on('message', () => { completed = true; });
  peer.on('pong', () => { if (!completed) pongsBeforeCompletion++; });
  const timer = setInterval(() => peer.ping('heartbeat'), 8);
  t.after(() => clearInterval(timer));
  const message = once(peer, 'message');
  assert.equal(await sendJson(client, {type: 'result', image: 'a'.repeat(1024 * 1024)}), true);
  await message;
  assert.ok(pongsBeforeCompletion >= 3, `only ${pongsBeforeCompletion} early pongs`);
});

test('disconnect abandons partial and queued messages; a new socket can recover saved data', async t => {
  const {client, peer} = await pair(t);
  pace(client);
  const saved = {type: 'result', id: 'saved', image: 'x'.repeat(512 * 1024)};
  const first = sendJson(client, saved);
  const queued = sendJson(client, {type: 'health', ok: true});
  setTimeout(() => peer.terminate(), 12);
  assert.deepEqual(await Promise.all([first, queued]), [false, false]);
  const fresh = await pair(t);
  const received = once(fresh.peer, 'message');
  assert.equal(await sendJson(fresh.client, saved), true);
  assert.deepEqual(JSON.parse((await received)[0].toString()), saved);
});

test('closed sockets do not send and diagnostics contain no screenshot payload', async t => {
  assert.equal(await sendJson(null, {type: 'health'}), false);
  const {client, peer} = await pair(t);
  const logs = [];
  const message = once(peer, 'message');
  assert.equal(await sendJson(client, {type: 'result', id: 'check', image: 'private-image-data'.repeat(10000)}, {
    log: (event, fields) => logs.push({event, ...fields})
  }), true);
  await message;
  assert.deepEqual(logs.map(log => log.event), ['transport_send_started', 'transport_send_finished']);
  assert.ok(logs[1].bytes > 100000);
  assert.ok(!JSON.stringify(logs).includes('private-image-data'));
});
