const connections = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("cocos-hierarchy-panel-")) return;

  const tabId = Number(port.name.replace("cocos-hierarchy-panel-", ""));
  if (!Number.isFinite(tabId)) return;

  if (!connections.has(tabId)) connections.set(tabId, new Set());
  connections.get(tabId).add(port);

  port.onDisconnect.addListener(() => {
    connections.get(tabId)?.delete(port);
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== "cocos-hierarchy-event") return;

  const tabId = sender.tab?.id;
  if (tabId == null) return;

  const ports = connections.get(tabId);
  if (!ports) return;

  for (const port of ports) {
    port.postMessage(message);
  }
});
