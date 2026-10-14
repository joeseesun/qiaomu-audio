// Yield to the event loop so a long encode keeps the UI responsive. A message-channel task needs no timer,
// so it works in every Obsidian window and under Node tests.
export const defer = () => new Promise(resolve => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => { port1.close(); resolve(); };
  port2.postMessage(0);
});
