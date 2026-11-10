// Keep each JSON message intact while allowing WebSocket ping/pong control
// frames between bounded fragments. All application writes share this queue:
// another JSON message must never become part of an unfinished message.
const queues = new WeakMap();
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function frame(socket, data, fin) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = error => {
      if (finished) return;
      finished = true;
      socket.off('close', closed);
      error ? reject(error) : resolve();
    };
    const closed = () => done(new Error('Socket closed during send'));
    socket.once('close', closed);
    try {
      socket.send(data, {binary: false, fin, compress: false}, done);
    } catch (error) { done(error); }
  });
}

export function sendJson(socket, message, {chunkBytes = 16 * 1024, log = () => {}} = {}) {
  if (!socket || socket.readyState !== 1) return Promise.resolve(false);
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) throw new Error('Invalid fragment size');
  const payload = Buffer.from(JSON.stringify(message));
  const large = payload.length > chunkBytes;
  const fields = {id: message.id, type: message.type, bytes: payload.length};
  const task = (queues.get(socket) ?? Promise.resolve()).then(async () => {
    if (socket.readyState !== 1) return false;
    const started = Date.now();
    if (large) log('transport_send_started', fields);
    try {
      for (let offset = 0; offset < payload.length; offset += chunkBytes) {
        if (socket.readyState !== 1) throw new Error('Socket closed during send');
        const end = Math.min(offset + chunkBytes, payload.length);
        await frame(socket, payload.subarray(offset, end), end === payload.length);
        if (end < payload.length) await nextTurn();
      }
      if (large) log('transport_send_finished', {...fields, elapsedMs: Date.now() - started});
      return true;
    } catch (error) {
      log('transport_send_failed', {...fields, elapsedMs: Date.now() - started, error: error.name});
      // Abandon a partially sent message. Recovery resends its saved result on
      // the new connection without executing the tool a second time.
      if (socket.readyState === 1) socket.terminate();
      return false;
    }
  });
  queues.set(socket, task);
  return task;
}
