(function () {
  const BRIDGE_VERSION = 2;
  if (window.__cocosHierarchyBridge__?.version >= BRIDGE_VERSION) return;

  const nodeCache = new Map();
  let bridgePaused = false;

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
    }
    return !!node;
  }

  function selectComponent(uuid, componentIndex) {
    const node = getNodeByUuid(uuid);
    if (!node) return false;
    const index = Number(componentIndex);
    if (!Number.isFinite(index) || index < 0) return false;
    const comp = node._components?.[index];
    if (!comp) return false;
    window.$c = comp;
    return true;
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

  function getNodePath(node) {
    if (!node) return "";
    const parts = [];
    let curr = node;
    while (curr) {
      parts.push(curr.name || "(unnamed)");
      curr = curr.parent || null;
    }
    return parts.reverse().join("/");
  }

  function findNodeByUuid(root, uuid) {
    if (!root) return null;
    if (root.uuid === uuid) return root;
    const children = root.children || [];
    for (const child of children) {
      const found = findNodeByUuid(child, uuid);
      if (found) return found;
    }
    return null;
  }

  function scanObjectForNodeRef(value, target, visited, depth) {
    if (!value || depth > 4) return false;
    const t = typeof value;
    if (t !== "object" && t !== "function") return false;
    if (value === target) return true;
    if (visited.has(value)) return false;
    visited.add(value);

    const keys = Object.keys(value);
    for (const key of keys) {
      if (key[0] === "_") continue;
      let child;
      try {
        child = value[key];
      } catch {
        continue;
      }
      if (child === target) return true;
      if (scanObjectForNodeRef(child, target, visited, depth + 1)) return true;
    }
    return false;
  }

  function findNodeReferences(targetUuid) {
    const uuid = String(targetUuid || "").trim();
    if (!uuid) return { ok: false, error: "Enter a node UUID" };

    const cc = getCocos();
    const scene = cc?.director?.getScene?.();
    if (!scene) return { ok: false, error: "No active scene" };

    const target = findNodeByUuid(scene, uuid);
    if (!target) return { ok: false, error: `Node not found for UUID: ${uuid}` };

    const hits = [];
    const stack = [scene];
    while (stack.length) {
      const node = stack.pop();
      const comps = node?._components || [];
      for (const comp of comps) {
        if (!comp) continue;
        const visited = new WeakSet();
        if (scanObjectForNodeRef(comp, target, visited, 0)) {
          const compName =
            comp.constructor?.name ||
            (cc?.js?.getClassName ? cc.js.getClassName(comp) : "Component");
          hits.push({
            nodeUuid: node.uuid,
            nodeName: node.name || "(unnamed)",
            hierarchyPath: getNodePath(node),
            componentName: compName || "Component",
          });
        }
      }
      const children = node?.children || [];
      for (const child of children) stack.push(child);
    }

    return {
      ok: true,
      target: { uuid: target.uuid, name: target.name, path: getNodePath(target) },
      count: hits.length,
      hits,
    };
  }

  function findSpineComponent(node) {
    const comps = node?._components || [];
    return (
      comps.find((comp) => {
        const ctorName = comp?.constructor?.name || "";
        let className = "";
        try {
          className = getCocos()?.js?.getClassName?.(comp) || "";
        } catch {}
        const name = `${ctorName} ${className}`.trim();
        return (
          /spine|skeleton/i.test(name) ||
          ctorName === "sp.Skeleton" ||
          ctorName === "Skeleton" ||
          className === "sp.Skeleton" ||
          className === "Skeleton"
        );
      }) || null
    );
  }

  function traceSpineAnimation(nodeUuid, animationName) {
    const uuid = String(nodeUuid || "").trim();
    const anim = String(animationName || "").trim();
    if (!uuid) return { ok: false, error: "Node UUID is required" };
    if (!anim) return { ok: false, error: "Animation name is required" };

    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: `Node not found for UUID: ${uuid}` };

    const spine = findSpineComponent(node);
    if (!spine) return { ok: false, error: "Selected node has no Spine/Skeleton component" };

    if (!spine.__animTracerOriginalSetAnimation && typeof spine.setAnimation === "function") {
      spine.__animTracerOriginalSetAnimation = spine.setAnimation.bind(spine);
      spine.setAnimation = function (...args) {
        const name = args[1] ?? args[0];
        if (String(name) === anim) {
          console.groupCollapsed(
            "%c AnimTracer %c Spine animation hit ",
            "background:#1a73e8;color:#fff;padding:1px 4px;border-radius:3px 0 0 3px;",
            "background:#34a853;color:#fff;padding:1px 4px;border-radius:0 3px 3px 0;",
          );
          console.log("node:", node);
          console.log("animation:", name);
          console.trace();
          console.groupEnd();
          debugger;
        }
        return spine.__animTracerOriginalSetAnimation(...args);
      };
    }

    if (!spine.__animTracerOriginalAddAnimation && typeof spine.addAnimation === "function") {
      spine.__animTracerOriginalAddAnimation = spine.addAnimation.bind(spine);
      spine.addAnimation = function (...args) {
        const name = args[1] ?? args[0];
        if (String(name) === anim) {
          console.groupCollapsed(
            "%c AnimTracer %c Spine queued animation hit ",
            "background:#1a73e8;color:#fff;padding:1px 4px;border-radius:3px 0 0 3px;",
            "background:#34a853;color:#fff;padding:1px 4px;border-radius:0 3px 3px 0;",
          );
          console.log("node:", node);
          console.log("animation:", name);
          console.trace();
          console.groupEnd();
          debugger;
        }
        return spine.__animTracerOriginalAddAnimation(...args);
      };
    }

    spine.__animTracerTraceAnimationName = anim;
    return { ok: true, message: `Tracing animation "${anim}" on node "${node.name}"` };
  }

  function getSpineAnimationNames(nodeUuid) {
    const uuid = String(nodeUuid || "").trim();
    if (!uuid) return { ok: false, error: "Node UUID is required", names: [] };

    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: `Node not found for UUID: ${uuid}`, names: [] };

    const spine = findSpineComponent(node);
    if (!spine) {
      return { ok: false, error: "Selected node has no Spine/Skeleton component", names: [] };
    }

    const names = new Set();
    const skeletonData = spine.skeletonData || spine._skeletonData || spine._skeleton?.data;

    try {
      const enumData = skeletonData?.getAnimsEnum?.();
      if (enumData && typeof enumData === "object") {
        Object.keys(enumData).forEach((key) => names.add(String(key)));
      }
    } catch {}

    const runtimeData =
      skeletonData?._skeletonData ||
      skeletonData?._data ||
      skeletonData?.skeletonJson ||
      skeletonData?._skeletonJson ||
      skeletonData?.data ||
      spine?._skeleton?.data ||
      spine?.skeleton?.data ||
      spine?._state?.data?.skeletonData ||
      skeletonData;

    const runtimeAnimations = runtimeData?.animations;
    if (Array.isArray(runtimeAnimations)) {
      runtimeAnimations.forEach((item) => {
        const name = item?.name;
        if (name) names.add(String(name));
      });
    } else if (runtimeAnimations && typeof runtimeAnimations === "object") {
      Object.keys(runtimeAnimations).forEach((key) => names.add(String(key)));
    }

    if (spine._animationName) names.add(String(spine._animationName));
    if (spine.animation) names.add(String(spine.animation));

    return { ok: true, names: Array.from(names).filter(Boolean).sort() };
  }

  function setGameSpeed(speed) {
    const cc = getCocos();
    const director = cc?.director;
    if (!director) return { ok: false, error: "Cocos director not found" };

    const numericSpeed = Number(speed);
    if (!Number.isFinite(numericSpeed) || numericSpeed <= 0) {
      return { ok: false, error: "Speed must be greater than 0" };
    }

    const originalTick = director._originalTick ?? director.tick?.bind(director);
    if (typeof originalTick !== "function") {
      return { ok: false, error: "director.tick is not available" };
    }

    if (!director._originalTick) {
      director._originalTick = originalTick;
    }

    director.tick = (dt, ...args) => {
      originalTick(dt * numericSpeed, ...args);
    };
    director.__animTracerGameSpeed = numericSpeed;
    return { ok: true, speed: numericSpeed };
  }

  function getGameSpeed() {
    const cc = getCocos();
    const director = cc?.director;
    if (!director) return { ok: false, speed: 1 };
    return { ok: true, speed: director.__animTracerGameSpeed ?? 1 };
  }

  function readPausedState(director) {
    try {
      if (director && typeof director.isPaused === "function") {
        return director.isPaused();
      }
      if (director && typeof director.isPaused === "boolean") {
        return director.isPaused;
      }
    } catch {
      // Fall back to bridge-tracked state.
    }
    return bridgePaused;
  }

  function invokePause(cc) {
    const director = cc?.director;
    if (director && typeof director.pause === "function") {
      director.pause.call(director);
      return true;
    }
    const game = cc?.game;
    if (game && typeof game.pause === "function") {
      game.pause.call(game);
      return true;
    }
    return false;
  }

  function invokeResume(cc) {
    const director = cc?.director;
    if (director && typeof director.resume === "function") {
      director.resume.call(director);
      return true;
    }
    const game = cc?.game;
    if (game && typeof game.resume === "function") {
      game.resume.call(game);
      return true;
    }
    return false;
  }

  function togglePauseResume() {
    const cc = getCocos();
    if (!cc) return { ok: false, error: "Cocos runtime not found" };

    const nextPaused = !bridgePaused;
    try {
      if (nextPaused) {
        if (!invokePause(cc)) {
          return { ok: false, error: "pause not available on director or game" };
        }
      } else if (!invokeResume(cc)) {
        return { ok: false, error: "resume not available on director or game" };
      }
      bridgePaused = nextPaused;
      return { ok: true, paused: bridgePaused };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  function getPauseState() {
    const cc = getCocos();
    if (!cc) return { ok: false, paused: false };
    const director = cc.director;
    if (director) {
      bridgePaused = readPausedState(director);
    }
    return { ok: true, paused: bridgePaused };
  }

  function setupPauseKeyboardShortcut() {
    if (window.__animTracerPauseKeyHandler) return;
    window.__animTracerPauseKeyHandler = (e) => {
      if (e.code !== "KeyP") return;
      const target = e.target;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      togglePauseResume();
    };
    window.addEventListener("keydown", window.__animTracerPauseKeyHandler);
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
    setupPauseKeyboardShortcut();

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
    version: BRIDGE_VERSION,
    getHierarchy,
    selectNode,
    selectComponent,
    toggleActive,
    setActive,
    findNodeReferences,
    traceSpineAnimation,
    getSpineAnimationNames,
    setGameSpeed,
    getGameSpeed,
    togglePauseResume,
    getPauseState,
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
