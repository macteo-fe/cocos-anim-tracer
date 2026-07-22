(function () {
  function injectScript() {
    const script = document.createElement("script");
    script.src = `${chrome.runtime.getURL("src/inject.js")}?v=${chrome.runtime.getManifest().version}&b=11`;
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  injectScript();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "cocos-hierarchy") return;

    chrome.runtime.sendMessage({
      type: "cocos-hierarchy-event",
      payload: data,
      frameId: window === window.top ? 0 : -1,
      url: location.href,
    });
  });
})();
