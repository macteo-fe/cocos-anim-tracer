(function () {
  if (window.__cocosHierarchyBridge__) return;

  const nodeCache = new Map();

  function getCocos() {
    if (window.cc?.director) return window.cc;
    if (window.cocos?.director) return window.cocos;
    return null;
  }

  function getPosition(node) {
    if (node.position) {
      return { x: node.position.x, y: node.position.y, z: node.position.z || 0 };
    }
    return { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };
  }

  function getComponentNames(node) {
    const comps = node._components || [];
    return comps.map((comp) => {
      if (!comp) return "Unknown";
      const ctor = comp.constructor;
      if (ctor?.name && ctor.name !== "Object") return ctor.name;
      if (window.cc?.js?.getClassName) {
        try {
          return cc.js.getClassName(comp) || "Component";
        } catch {
          return "Component";
        }
      }
      return "Component";
    });
  }

  function isSpineNode(components) {
    return components.some(
      (name) =>
        /spine|skeleton/i.test(name) ||
        name === "sp.Skeleton" ||
        name === "Skeleton"
    );
  }

  function serializeNode(node) {
    if (!node) return null;

    const components = getComponentNames(node);
    const uuid = node.uuid || String(node._id ?? Math.random());
    nodeCache.set(uuid, node);

    return {
      uuid,
      name: node.name || "(unnamed)",
      active: node.active !== false,
      activeInHierarchy:
        node.activeInHierarchy !== undefined ? node.activeInHierarchy : node.active !== false,
      position: getPosition(node),
      layer: node.layer ?? 0,
      components,
      isSpine: isSpineNode(components),
      childCount: (node.children || []).length,
      children: (node.children || []).map(serializeNode).filter(Boolean),
    };
  }

  function getHierarchy() {
    const cc = getCocos();
    if (!cc) {
      return { ok: false, error: "Cocos runtime not found (window.cc)" };
    }

    const scene = cc.director.getScene?.();
    if (!scene) {
      return { ok: false, error: "No active scene" };
    }

    nodeCache.clear();
    const tree = serializeNode(scene);
    return {
      ok: true,
      engineVersion: cc.ENGINE_VERSION || "unknown",
      sceneName: scene.name || "Scene",
      tree,
    };
  }

  function getNodeByUuid(uuid) {
    return nodeCache.get(uuid) || null;
  }

  function selectNode(uuid) {
    const node = getNodeByUuid(uuid);
    if (node) {
      window.$n = node;
      console.log("[Cocos Hierarchy]", node);
    }
    return !!node;
  }

  function toggleActive(uuid) {
    const node = getNodeByUuid(uuid);
    if (!node) return false;
    node.active = !node.active;
    return node.active;
  }

  function setActive(uuid, active) {
    const node = getNodeByUuid(uuid);
    if (!node) return false;
    node.active = !!active;
    return node.active;
  }

  function notifyUpdate() {
    window.postMessage({ source: "cocos-hierarchy", type: "scene-changed" }, "*");
  }

  function hookDirector(cc) {
    if (!cc.director || cc.director.__hierarchyHooked) return;
    cc.director.__hierarchyHooked = true;

    const origLoadScene = cc.director.loadScene;
    if (typeof origLoadScene === "function") {
      cc.director.loadScene = function (...args) {
        const result = origLoadScene.apply(this, args);
        setTimeout(notifyUpdate, 100);
        return result;
      };
    }
  }

  function init() {
    const cc = getCocos();
    if (!cc) return false;

    hookDirector(cc);

    if (cc.game?.on) {
      cc.game.on("game_on_show", notifyUpdate);
    }

    console.log(
      "%c Cocos Hierarchy %c Runtime detected ",
      "background:#1a73e8;padding:2px 6px;border-radius:3px 0 0 3px;color:#fff",
      "background:#34a853;padding:2px 6px;border-radius:0 3px 3px 0;color:#fff"
    );

    notifyUpdate();
    return true;
  }

  window.__cocosHierarchyBridge__ = {
    getHierarchy,
    selectNode,
    toggleActive,
    setActive,
    init,
    isReady: () => !!getCocos(),
  };

  if (!init()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (init() || attempts >= 120) clearInterval(timer);
    }, 500);
  }
})();
