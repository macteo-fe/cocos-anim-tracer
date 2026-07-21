(function () {
  const BRIDGE_VERSION = 8;
  // Always refresh bridge API so extension reloads apply even if an older
  // inject already set window.__cocosHierarchyBridge__.

  const nodeCache = new Map();
  let bridgePaused = false;
  try {
    const prev = window.__cocosHierarchyBridge__?.getPauseState?.();
    if (prev?.ok) bridgePaused = !!prev.paused;
  } catch {}

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
    if (node.name === "__AnimTracerHL__") return null;

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
    if (!uuid) return null;
    if (nodeCache.has(uuid)) return nodeCache.get(uuid);
    const scene = getCocos()?.director?.getScene?.();
    if (!scene) return null;
    const node = findNodeByUuid(scene, uuid);
    if (node) nodeCache.set(uuid, node);
    return node;
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

  function isSkippedRefKey(key, depth) {
    if (!key || key.startsWith("__")) return true;
    if (
      key === "constructor" ||
      key === "prototype" ||
      key === "_id" ||
      key === "_objFlags" ||
      key === "_name" ||
      key === "_enabled" ||
      key === "_parent" ||
      key === "_children" ||
      key === "_components" ||
      key === "_scene" ||
      key === "_eventProcessor" ||
      key === "_persistNode" ||
      key === "pos" ||
      key === "rot" ||
      key === "scale"
    ) {
      return true;
    }
    if (depth === 0 && (key === "node" || key === "_node")) return true;
    return false;
  }

  function collectOwnKeys(value) {
    const keys = new Set();
    // Own keys only — never walk prototypes (Cocos proto getters spam deprecation errors).
    try {
      Object.keys(value).forEach((key) => keys.add(key));
    } catch {}
    try {
      Object.getOwnPropertyNames(value).forEach((key) => keys.add(key));
    } catch {}
    try {
      const declared = value.constructor?.__values__ || value.constructor?.__props__;
      if (Array.isArray(declared)) declared.forEach((key) => keys.add(key));
    } catch {}
    return keys;
  }

  function safeReadOwn(value, key) {
    try {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (desc && "value" in desc) return desc.value;
        return value[key];
      }
      // Cocos @property storage is usually `_fieldName` on the instance.
      const privateKey = key[0] === "_" ? null : `_${key}`;
      if (privateKey && Object.prototype.hasOwnProperty.call(value, privateKey)) {
        return value[privateKey];
      }
      // Never read prototype getters — they trigger Cocos deprecation errors.
      return undefined;
    } catch {
      return undefined;
    }
  }

  function isNodeLike(value, target) {
    if (!value || typeof value !== "object") return false;
    if (value === target) return true;
    try {
      return !!(value.uuid && target.uuid && value.uuid === target.uuid && value._components);
    } catch {
      return false;
    }
  }

  function shouldNotDescend(value) {
    if (!value || typeof value !== "object") return true;
    if (Array.isArray(value)) return false;
    if (ArrayBuffer.isView(value)) return true;
    const name = value.constructor?.name || "";
    if (
      /^(Vec2|Vec3|Vec4|Color|Quat|Mat3|Mat4|Size|Rect|Node|Scene|Component|Asset|Texture2D|TextureBase|TextureCube|Material|Mesh|MeshBuffer|Pass|Device|Camera|RenderTexture|SpriteFrame|BitmapFont|Font|EffectAsset|Graphics|UITransform|UIOpacity|Widget|Label|Sprite|RichText|Layout|Mask|Canvas|Model|SubModel|Renderer|Renderable2D|Batcher2D|NodeEventProcessor|SystemEvent)$/.test(
        name
      )
    ) {
      return true;
    }
    // Node / component shaped objects
    try {
      if (value.uuid && value._components) return true;
      if (value.node && value.uuid === undefined && value._id !== undefined) return true;
    } catch {}
    return false;
  }

  function scanObjectForNodeRef(value, target, visited, depth, path) {
    if (!value || depth > 3) return [];
    if (typeof value !== "object") return [];
    if (visited.has(value)) return [];
    visited.add(value);

    const hits = [];
    for (const key of collectOwnKeys(value)) {
      if (isSkippedRefKey(key, depth)) continue;

      const child = safeReadOwn(value, key);
      if (child == null || typeof child === "function") continue;

      const isIndex = Array.isArray(value) && /^\d+$/.test(key);
      const fieldPath = path
        ? isIndex
          ? `${path}[${key}]`
          : `${path}.${key}`
        : key.replace(/^_/, "");

      if (isNodeLike(child, target)) {
        hits.push(fieldPath);
        continue;
      }
      if (shouldNotDescend(child)) continue;
      hits.push(...scanObjectForNodeRef(child, target, visited, depth + 1, fieldPath));
    }
    return hits;
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
        const fieldNames = scanObjectForNodeRef(comp, target, visited, 0, "");
        if (!fieldNames.length) continue;
        const compName =
          comp.constructor?.name ||
          (cc?.js?.getClassName ? cc.js.getClassName(comp) : "Component");
        for (const fieldName of fieldNames) {
          hits.push({
            nodeUuid: node.uuid,
            nodeName: node.name || "(unnamed)",
            hierarchyPath: getNodePath(node),
            componentName: compName || "Component",
            fieldName,
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

  function restoreSpineTraceHooks(spine) {
    if (!spine) return false;
    let cleared = false;
    if (spine.__animTracerOriginalSetAnimation) {
      spine.setAnimation = spine.__animTracerOriginalSetAnimation;
      delete spine.__animTracerOriginalSetAnimation;
      cleared = true;
    }
    if (spine.__animTracerOriginalAddAnimation) {
      spine.addAnimation = spine.__animTracerOriginalAddAnimation;
      delete spine.__animTracerOriginalAddAnimation;
      cleared = true;
    }
    if (spine.__animTracerTraceAnimationName !== undefined) {
      delete spine.__animTracerTraceAnimationName;
      cleared = true;
    }
    return cleared;
  }

  function clearSpineAnimationTrace(nodeUuid) {
    const uuid = String(nodeUuid || "").trim();
    if (!uuid) return { ok: false, error: "Node UUID is required" };

    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: `Node not found for UUID: ${uuid}` };

    const spine = findSpineComponent(node);
    if (!spine) return { ok: false, error: "Selected node has no Spine/Skeleton component" };

    const cleared = restoreSpineTraceHooks(spine);
    return {
      ok: true,
      cleared,
      message: cleared
        ? `Cleared spine trace on node "${node.name}"`
        : "No active spine trace on this node",
    };
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

  const HIGHLIGHT_STYLE_ID = "__animtracer-highlight-style__";
  const HIGHLIGHT_EL_ID = "__animtracer-node-highlight__";
  let highlightRaf = 0;
  let highlightUuid = null;

  function getGameCanvas() {
    return (
      document.getElementById("GameCanvas") ||
      document.querySelector("canvas#GameCanvas") ||
      document.querySelector("canvas")
    );
  }

  function getUITransform(node) {
    if (!node) return null;
    if (node._uiProps?.uiTransformComp) return node._uiProps.uiTransformComp;
    const comps = node._components || [];
    return (
      comps.find((comp) => {
        const name = comp?.constructor?.name || "";
        return name === "UITransform" || name === "cc.UITransform" || /UITransform/i.test(name);
      }) || null
    );
  }

  function getNodeWorldRect(node) {
    const ui = getUITransform(node);

    // Prefer the node's own content size corners in world space (stable AABB).
    if (ui) {
      let width = 0;
      let height = 0;
      let ax = 0.5;
      let ay = 0.5;
      try {
        width = Number(ui.contentSize?.width ?? ui.width ?? 0) || 0;
        height = Number(ui.contentSize?.height ?? ui.height ?? 0) || 0;
        ax = Number(ui.anchorPoint?.x ?? ui.anchorX ?? 0.5);
        ay = Number(ui.anchorPoint?.y ?? ui.anchorY ?? 0.5);
      } catch {}

      if ((width > 0 || height > 0) && typeof ui.convertToWorldSpaceAR === "function") {
        const locals = [
          [-width * ax, -height * ay],
          [width * (1 - ax), -height * ay],
          [-width * ax, height * (1 - ay)],
          [width * (1 - ax), height * (1 - ay)],
        ];
        const worlds = [];
        for (const [lx, ly] of locals) {
          try {
            const out = makeVec3(0, 0, 0);
            const ret = ui.convertToWorldSpaceAR(makeVec3(lx, ly, 0), out) || out;
            worlds.push({ x: ret.x, y: ret.y });
          } catch {
            worlds.length = 0;
            break;
          }
        }
        if (worlds.length === 4) {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const p of worlds) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
          }
          return {
            x: minX,
            y: minY,
            width: Math.max(maxX - minX, 1),
            height: Math.max(maxY - minY, 1),
          };
        }
      }
    }

    if (ui?.getBoundingBoxToWorld) {
      try {
        const rect = ui.getBoundingBoxToWorld();
        const width = Number(rect?.width) || 0;
        const height = Number(rect?.height) || 0;
        if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && (width > 1 || height > 1)) {
          return { x: rect.x, y: rect.y, width, height };
        }
      } catch {}
    }

    let wp = node.worldPosition;
    try {
      if (!wp && typeof node.getWorldPosition === "function") {
        wp = node.getWorldPosition();
      }
    } catch {}
    wp = wp || { x: 0, y: 0 };
    return {
      x: wp.x - 20,
      y: wp.y - 20,
      width: 40,
      height: 40,
    };
  }

  function findCameraForNode(node) {
    let curr = node;
    while (curr) {
      const comps = curr._components || [];
      for (const comp of comps) {
        const name = comp?.constructor?.name || "";
        if (name === "Canvas" || name === "cc.Canvas") {
          const camComp = comp.cameraComponent || comp.camera;
          return camComp?.camera || camComp || comp._camera || null;
        }
        if (name === "Camera" || name === "cc.Camera") {
          return comp.camera || comp;
        }
      }
      curr = curr.parent;
    }

    const scene = getCocos()?.director?.getScene?.();
    if (!scene) return null;
    const stack = [scene];
    while (stack.length) {
      const n = stack.pop();
      const comps = n?._components || [];
      for (const comp of comps) {
        const name = comp?.constructor?.name || "";
        if (name === "Camera" || name === "cc.Camera") {
          return comp.camera || comp;
        }
      }
      for (const child of n?.children || []) stack.push(child);
    }
    return null;
  }

  function makeVec3(x, y, z = 0) {
    const cc = getCocos();
    const Vec3 = cc?.math?.Vec3 || cc?.Vec3;
    if (typeof Vec3 === "function") {
      try {
        return new Vec3(x, y, z);
      } catch {}
    }
    return { x, y, z };
  }

  function screenSpread(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      spread: maxX - minX + (maxY - minY),
    };
  }

  function projectWorldCorners(camera, rect) {
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height],
    ];

    const tryOrder = (order) => {
      const points = [];
      for (const [x, y] of corners) {
        const world = makeVec3(x, y, 0);
        const out = makeVec3(0, 0, 0);
        try {
          let ret;
          if (order === "worldFirst") {
            ret = camera.worldToScreen(world, out);
          } else {
            ret = camera.worldToScreen(out, world);
          }
          const p = ret && typeof ret.x === "number" ? ret : out;
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
          points.push({ x: p.x, y: p.y });
        } catch {
          return null;
        }
      }
      return points;
    };

    // Cocos versions disagree on argument order; pick the projection with real size.
    const a = tryOrder("worldFirst");
    const b = tryOrder("outFirst");
    const aInfo = a ? screenSpread(a) : null;
    const bInfo = b ? screenSpread(b) : null;
    if (aInfo && bInfo) return aInfo.spread >= bInfo.spread ? a : b;
    return a || b;
  }

  function worldRectToCss(rect, node) {
    const canvas = getGameCanvas();
    if (!canvas) return null;
    const canvasRect = canvas.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) return null;

    const bufferW = canvas.width || canvasRect.width;
    const bufferH = canvas.height || canvasRect.height;
    const scaleX = canvasRect.width / bufferW;
    const scaleY = canvasRect.height / bufferH;

    const camera = findCameraForNode(node);
    if (camera && typeof camera.worldToScreen === "function") {
      const points = projectWorldCorners(camera, rect);
      if (points) {
        const { minX, minY, maxX, maxY, spread } = screenSpread(points);
        if (spread > 2) {
          // CC 3.6+ docs: screen space is left-top origin. Also try bottom-left
          // if the top-left mapping puts the box far outside the canvas.
          const topLeft = {
            left: canvasRect.left + minX * scaleX,
            top: canvasRect.top + minY * scaleY,
            width: Math.max((maxX - minX) * scaleX, 2),
            height: Math.max((maxY - minY) * scaleY, 2),
          };
          const bottomLeft = {
            left: canvasRect.left + minX * scaleX,
            top: canvasRect.top + (bufferH - maxY) * scaleY,
            width: Math.max((maxX - minX) * scaleX, 2),
            height: Math.max((maxY - minY) * scaleY, 2),
          };

          const fits = (box) =>
            box.left + box.width > canvasRect.left - 40 &&
            box.top + box.height > canvasRect.top - 40 &&
            box.left < canvasRect.right + 40 &&
            box.top < canvasRect.bottom + 40;

          if (fits(topLeft)) return topLeft;
          if (fits(bottomLeft)) return bottomLeft;
          return topLeft;
        }
      }
    }

    // Fallback: map design/visible size to canvas CSS box (common for UI games).
    const cc = getCocos();
    const view = cc?.view;
    const visible = view?.getVisibleSize?.() || { width: canvasRect.width, height: canvasRect.height };
    const origin = view?.getVisibleOrigin?.() || { x: 0, y: 0 };
    const sx = canvasRect.width / (visible.width || 1);
    const sy = canvasRect.height / (visible.height || 1);
    return {
      left: canvasRect.left + (rect.x - origin.x) * sx,
      top: canvasRect.top + (visible.height - (rect.y - origin.y) - rect.height) * sy,
      width: Math.max(rect.width * sx, 2),
      height: Math.max(rect.height * sy, 2),
    };
  }

  function ensureHighlightEl() {
    if (!document.getElementById(HIGHLIGHT_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = `
        #${HIGHLIGHT_EL_ID} {
          position: fixed;
          pointer-events: none;
          z-index: 2147483646;
          border: 2px solid #3794ff;
          background: rgba(55, 148, 255, 0.18);
          box-sizing: border-box;
          border-radius: 2px;
          display: none;
        }
        #${HIGHLIGHT_EL_ID} .animtracer-hl-label {
          position: absolute;
          left: 0;
          top: -18px;
          max-width: 240px;
          overflow: hidden;
          text-overflow: ellipsis;
          font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #fff;
          background: #3794ff;
          padding: 0 5px;
          white-space: nowrap;
          border-radius: 2px;
        }
      `;
      document.documentElement.appendChild(style);
    }

    let el = document.getElementById(HIGHLIGHT_EL_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = HIGHLIGHT_EL_ID;
      const label = document.createElement("div");
      label.className = "animtracer-hl-label";
      el.appendChild(label);
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function updateHighlightFrame() {
    if (!highlightUuid) return;
    const node = getNodeByUuid(highlightUuid);
    const el = ensureHighlightEl();
    if (!node || node.isValid === false) {
      el.style.display = "none";
      return;
    }

    const worldRect = getNodeWorldRect(node);
    const cssRect = worldRectToCss(worldRect, node);
    if (!cssRect) {
      el.style.display = "none";
      return;
    }

    el.style.display = "block";
    el.style.left = `${cssRect.left}px`;
    el.style.top = `${cssRect.top}px`;
    el.style.width = `${cssRect.width}px`;
    el.style.height = `${cssRect.height}px`;
    const label = el.querySelector(".animtracer-hl-label");
    if (label) label.textContent = node.name || "(unnamed)";

    highlightRaf = requestAnimationFrame(updateHighlightFrame);
  }

  function highlightNode(uuid) {
    const id = String(uuid || "").trim();
    if (!id) return { ok: false, error: "UUID required" };
    const node = getNodeByUuid(id);
    if (!node) return { ok: false, error: "Node not found" };

    highlightUuid = id;
    if (highlightRaf) cancelAnimationFrame(highlightRaf);
    highlightRaf = requestAnimationFrame(updateHighlightFrame);
    return { ok: true, name: node.name || "(unnamed)" };
  }

  function clearNodeHighlight() {
    highlightUuid = null;
    if (highlightRaf) {
      cancelAnimationFrame(highlightRaf);
      highlightRaf = 0;
    }
    const el = document.getElementById(HIGHLIGHT_EL_ID);
    if (el) el.style.display = "none";
    return { ok: true };
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

    if (!window.__animTracerBridgeReadyLogged) {
      window.__animTracerBridgeReadyLogged = true;
      console.log(
        "%c Cocos Hierarchy %c Runtime detected ",
        "background:#1a73e8;padding:2px 6px;border-radius:3px 0 0 3px;color:#fff",
        "background:#34a853;padding:2px 6px;border-radius:0 3px 3px 0;color:#fff"
      );
    }

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
    clearSpineAnimationTrace,
    getSpineAnimationNames,
    setGameSpeed,
    getGameSpeed,
    togglePauseResume,
    getPauseState,
    highlightNode,
    clearNodeHighlight,
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
