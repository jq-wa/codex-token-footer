function connect(url) {
  const socket = new WebSocket(url);
  let serial = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000);
        pending.set(id, {resolve, reject, timeout});
        socket.send(JSON.stringify({id, method, params}));
      });
    },
    close() { socket.close(); }
  };
}

module.exports = {connect};
