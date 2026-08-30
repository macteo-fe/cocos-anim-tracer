(function () {
  const BRIDGE_VERSION = 27;
  // Always refresh bridge API so extension reloads apply even if an older
  // inject already set window.__cocosHierarchyBridge__.

  const nodeCache = new Map();
  const nodeEventBreakpoints = [];
  const NODE_BREAK_EVENT_ALIASES = {
    "parent-change": "parent-changed",
    "active-change": "active-changed",
    "add-child": "child-added",
    "remove-child": "child-removed",
    "transform-change": "transform-changed",
  };
  // Engine event names that Cocos actually emits (same mapping as cc-inspector).
  const NODE_BREAK_EVENT_CATALOG = [
    {
      id: "size-changed",
      label: "size changed",
      v2: { enabled: true, key: (et) => et?.SIZE_CHANGED },
      v3: { enabled: true, key: (et) => et?.SIZE_CHANGED },
    },
    {
      id: "transform-changed",
      label: "transform changed",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.TRANSFORM_CHANGED },
    },
    {
      id: "position-changed",
      label: "position changed",
      v2: { enabled: true, key: (et) => et?.POSITION_CHANGED },
      v3: { enabled: false, key: () => "" },
    },
    {
      id: "rotation-changed",
      label: "rotation changed",
      v2: { enabled: true, key: (et) => et?.ROTATION_CHANGED },
      v3: { enabled: false, key: () => "" },
    },
    {
      id: "scale-changed",
      label: "scale changed",
      v2: { enabled: true, key: (et) => et?.SCALE_CHANGED },
      v3: { enabled: false, key: () => "" },
    },
    {
      id: "color-changed",
      label: "color changed",
      v2: { enabled: true, key: (et) => et?.COLOR_CHANGED },
      v3: { enabled: true, key: (et) => et?.COLOR_CHANGED },
    },
    {
      id: "layer-changed",
      label: "layer changed",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.LAYER_CHANGED },
    },
    {
      id: "child-reorder",
      label: "child reorder",
      v2: { enabled: true, key: (et) => et?.CHILDREN_ORDER_CHANGED || et?.CHILD_REORDER },
      v3: { enabled: false, key: () => "" },
    },
    {
      id: "sibling-order-changed",
      label: "sibling order changed",
      v2: { enabled: true, key: (et) => et?.SIBLING_ORDER_CHANGED },
      v3: { enabled: true, key: (et) => et?.SIBLING_ORDER_CHANGED },
    },
    {
      id: "active-changed",
      label: "active changed",
      v2: { enabled: true, key: () => "active-in-hierarchy-changed" },
      v3: { enabled: true, key: (et) => et?.ACTIVE_CHANGED || et?.ACTIVE_IN_HIERARCHY_CHANGED },
    },
    {
      id: "destroyed",
      label: "destroyed",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.NODE_DESTROYED },
    },
    {
      id: "parent-changed",
      label: "parent changed",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.PARENT_CHANGED },
    },
    {
      id: "child-added",
      label: "child added",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.CHILD_ADDED },
    },
    {
      id: "child-removed",
      label: "child removed",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.CHILD_REMOVED },
    },
    {
      id: "component-added",
      label: "component added",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.COMPONENT_ADDED },
    },
    {
      id: "component-removed",
      label: "component removed",
      v2: { enabled: false, key: () => "" },
      v3: { enabled: true, key: (et) => et?.COMPONENT_REMOVED },
    },
  ];
  let bridgePaused = false;
  let bridgeGameSpeed = 1;
  try {
    const prev = window.__cocosHierarchyBridge__?.getPauseState?.();
    if (prev?.ok) bridgePaused = !!prev.paused;
  } catch {}
  try {
    const prevSpeed = window.__cocosHierarchyBridge__?.getGameSpeed?.();
    if (prevSpeed?.ok && Number.isFinite(Number(prevSpeed.speed))) {
      bridgeGameSpeed = Number(prevSpeed.speed);
    }
  } catch {}

  function getCocos() {
    if (window.cc?.director) return window.cc;
    if (window.cocos?.director) return window.cocos;
    return null;
  }

  function getEngineMajorVersion(cc = getCocos()) {
    const raw =
      cc?.ENGINE_VERSION ||
      cc?.engine?.version ||
      window.CC_ENGINE_VERSION ||
      "";
    const match = String(raw).match(/(\d+)/);
    if (match) return Number(match[1]);

    // Heuristics when version string is missing.
    try {
      if (typeof cc?.director?.tick === "function") return 3;
    } catch {}
    try {
      if (typeof cc?.director?.getScheduler === "function") return 2;
    } catch {}
    return 0;
  }

  function isCocos2x(cc = getCocos()) {
    const major = getEngineMajorVersion(cc);
    return major > 0 && major < 3;
  }

  // CC2.x Scene overrides active/activeInHierarchy getters to log:
  // '"active" is not defined in the Scene, it is only defined in normal nodes.'
  // Never touch those public getters on Scene — use private fields or treat as always active.
  function isSceneNode(node) {
    if (!node) return false;
    const cc = getCocos();
    try {
      if (cc?.Scene && (node instanceof cc.Scene || node.constructor === cc.Scene)) return true;
    } catch {}
    try {
      if (node.isScene === true) return true;
    } catch {}
    try {
      const scene = cc?.director?.getScene?.();
      if (scene && node === scene) return true;
    } catch {}
    return false;
  }

  function readNodeActive(node) {
    if (!node) return false;
    if (isSceneNode(node)) return true;
    // Prefer private field — safe if a Scene slipped past detection.
    if (typeof node._active === "boolean") return node._active;
    try {
      return node.active !== false;
    } catch {
      return true;
    }
  }

  function readNodeActiveInHierarchy(node) {
    if (!node) return false;
    if (isSceneNode(node)) return true;
    if (typeof node._activeInHierarchy === "boolean") return node._activeInHierarchy;
    try {
      if (node.activeInHierarchy !== undefined) return !!node.activeInHierarchy;
    } catch {}
    return readNodeActive(node);
  }

  function writeNodeActive(node, active) {
    if (!node) return false;
    if (isSceneNode(node)) return true;
    const next = !!active;
    try {
      node.active = next;
    } catch {
      try {
        node._active = next;
      } catch {
        return readNodeActive(node);
      }
    }
    return readNodeActive(node);
  }

  function getPosition(node) {
    return readNodePosition(node);
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
      active: readNodeActive(node),
      activeInHierarchy: readNodeActiveInHierarchy(node),
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
    syncNodeEventBreaks();
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

  const EDITABLE_SKIP_KEYS = new Set([
    "constructor",
    "prototype",
    "uuid",
    "node",
    "_id",
    "_objFlags",
    "_name",
    "_enabled",
    "_isOnLoadCalled",
    "enabledInHierarchy",
    "isValid",
    "worldPosition",
    "worldScale",
    "worldRotation",
    "worldMatrix",
    "matrix",
    "forward",
    "up",
    "right",
    "__scriptAsset",
    "__prefab",
    // CC2.1+ deprecated Node getters — reading them spams console warnings.
    "rotation",
    "rotationX",
    "rotationY",
    "_rotationX",
    "_rotationY",
    "skewX",
    "skewY",
  ]);

  function copyVec3Like(value, fallback = { x: 0, y: 0, z: 0 }) {
    if (!value || typeof value !== "object") return { ...fallback };
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      z: Number.isFinite(z) ? z : fallback.z,
    };
  }

  // Prefer private transform storage on CC2.x — public rotationX/Y/rotation getters warn since v2.1.0.
  function readNodePosition(node) {
    if (!node) return { x: 0, y: 0, z: 0 };
    try {
      if (node._position && typeof node._position === "object") {
        return copyVec3Like(node._position);
      }
    } catch {}
    try {
      if (typeof node.getPosition === "function") {
        const out = makeVec3(0, 0, 0);
        const ret = node.getPosition(out) || out;
        if (ret && typeof ret === "object") return copyVec3Like(ret);
      }
    } catch {}
    try {
      const pos = node.position;
      if (pos && typeof pos === "object") return copyVec3Like(pos);
    } catch {}
    return {
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      z: Number(node.z) || 0,
    };
  }

  function readNodeScale(node) {
    if (!node) return { x: 1, y: 1, z: 1 };
    try {
      if (node._scale && typeof node._scale === "object") {
        return copyVec3Like(node._scale, { x: 1, y: 1, z: 1 });
      }
    } catch {}
    try {
      // CC3: node.scale is Vec3. CC2: node.scale is a number (scaleX) — ignore that.
      const scale = node.scale;
      if (scale && typeof scale === "object") return copyVec3Like(scale, { x: 1, y: 1, z: 1 });
    } catch {}
    try {
      if (typeof node.getScale === "function") {
        const out = makeVec3(1, 1, 1);
        const ret = node.getScale(out);
        if (ret && typeof ret === "object") return copyVec3Like(ret, { x: 1, y: 1, z: 1 });
      }
    } catch {}
    try {
      const sx = Number(node.scaleX);
      const sy = Number(node.scaleY);
      const sz = Number(node.scaleZ);
      if (Number.isFinite(sx) || Number.isFinite(sy) || Number.isFinite(sz)) {
        return {
          x: Number.isFinite(sx) ? sx : 1,
          y: Number.isFinite(sy) ? sy : 1,
          z: Number.isFinite(sz) ? sz : 1,
        };
      }
    } catch {}
    return { x: 1, y: 1, z: 1 };
  }

  function readNodeEulerAngles(node) {
    if (!node) return null;
    try {
      if (node._eulerAngles && typeof node._eulerAngles === "object") {
        return copyVec3Like(node._eulerAngles);
      }
    } catch {}
    try {
      // Only use public eulerAngles when it is a real vec object.
      // Never fall back to rotationX/rotationY — those warn on CC2.1+.
      const euler = node.eulerAngles;
      if (euler && typeof euler === "object") return copyVec3Like(euler);
    } catch {}
    return null;
  }

  function readNodeAngle(node) {
    if (!node) return null;
    try {
      if (node._eulerAngles && typeof node._eulerAngles.z === "number") {
        return node._eulerAngles.z;
      }
    } catch {}
    try {
      if (typeof node.angle === "number") return node.angle;
    } catch {}
    return null;
  }

  function writeNodeEulerAngles(node, next) {
    if (!node || !next) return false;
    const x = Number(next.x) || 0;
    const y = Number(next.y) || 0;
    const z = Number(next.z) || 0;
    try {
      if (typeof node.setRotationFromEuler === "function") {
        node.setRotationFromEuler(x, y, z);
        return true;
      }
    } catch {}
    try {
      if (node.eulerAngles && typeof node.eulerAngles === "object") {
        writeStructuredValue(node.eulerAngles, { x, y, z }, ["x", "y", "z"]);
        try {
          node.eulerAngles = node.eulerAngles;
        } catch {}
        return true;
      }
    } catch {}
    try {
      if (node._eulerAngles && typeof node._eulerAngles === "object") {
        node._eulerAngles.x = x;
        node._eulerAngles.y = y;
        node._eulerAngles.z = z;
        if (typeof node._fromEuler === "function") node._fromEuler();
        return true;
      }
    } catch {}
    try {
      node.angle = z;
      return true;
    } catch {}
    return false;
  }

  function getComponentDisplayName(comp) {
    const ctorName = comp?.constructor?.name || "";
    try {
      const className = getCocos()?.js?.getClassName?.(comp);
      if (className) return className;
    } catch {}
    return ctorName || "Component";
  }

  function collectEditablePropKeys(target) {
    const keys = new Set();
    try {
      Object.keys(target).forEach((key) => keys.add(key));
    } catch {}
    try {
      Object.getOwnPropertyNames(target).forEach((key) => keys.add(key));
    } catch {}
    try {
      const declared = target.constructor?.__values__ || target.constructor?.__props__;
      if (Array.isArray(declared)) declared.forEach((key) => keys.add(key));
    } catch {}
    return keys;
  }

  function readTargetProp(target, key) {
    try {
      const displayKey = key[0] === "_" ? key.slice(1) : key;
      if (EDITABLE_SKIP_KEYS.has(key) || EDITABLE_SKIP_KEYS.has(displayKey)) {
        return { ok: false };
      }

      if (Object.prototype.hasOwnProperty.call(target, key)) {
        const desc = Object.getOwnPropertyDescriptor(target, key);
        if (desc && "value" in desc) return { ok: true, value: desc.value, rawKey: key };
      }
      const privateKey = key[0] === "_" ? null : `_${key}`;
      if (privateKey && Object.prototype.hasOwnProperty.call(target, privateKey)) {
        return { ok: true, value: target[privateKey], rawKey: privateKey };
      }

      // Last resort: public accessor. Skipped keys above block CC2 Node rotationX/Y/rotation.
      const value = target[key];
      if (value === undefined && !(key in target)) return { ok: false };
      return { ok: true, value, rawKey: key };
    } catch {
      return { ok: false };
    }
  }

  function normalizePropKey(key) {
    return key[0] === "_" ? key.slice(1) : key;
  }

  function ctorName(value) {
    try {
      return value?.constructor?.name || "";
    } catch {
      return "";
    }
  }

  function pickNumericFields(value, fields) {
    const out = {};
    for (const field of fields) {
      const n = Number(value?.[field]);
      out[field] = Number.isFinite(n) ? n : 0;
    }
    return out;
  }

  function describeEditableValue(value) {
    if (value == null) return null;
    const type = typeof value;
    if (type === "string" || type === "boolean") return { type, value };
    if (type === "number") {
      return Number.isFinite(value) ? { type: "number", value } : null;
    }
    if (type !== "object") return null;

    if (Array.isArray(value)) {
      const items = [];
      for (let i = 0; i < value.length; i++) {
        const item = describeReferenceValue(value[i]);
        if (item) items.push({ ...item, index: i });
      }
      if (!items.length) return null;
      return { type: "refList", fields: null, value: items };
    }

    const ref = describeReferenceValue(value);
    if (ref) return ref;

    const name = ctorName(value);
    if (name === "Vec2" || name === "math.Vec2") {
      return { type: "vec2", fields: ["x", "y"], value: pickNumericFields(value, ["x", "y"]) };
    }
    if (name === "Vec3" || name === "math.Vec3") {
      return { type: "vec3", fields: ["x", "y", "z"], value: pickNumericFields(value, ["x", "y", "z"]) };
    }
    if (name === "Vec4" || name === "math.Vec4" || name === "Quat" || name === "math.Quat") {
      const fields = ["x", "y", "z", "w"];
      return { type: name.includes("Quat") ? "quat" : "vec4", fields, value: pickNumericFields(value, fields) };
    }
    if (name === "Size" || name === "math.Size") {
      return {
        type: "size",
        fields: ["width", "height"],
        value: pickNumericFields(value, ["width", "height"]),
      };
    }
    if (name === "Rect" || name === "math.Rect") {
      return {
        type: "rect",
        fields: ["x", "y", "width", "height"],
        value: pickNumericFields(value, ["x", "y", "width", "height"]),
      };
    }
    if (name === "Color" || name === "math.Color") {
      return {
        type: "color",
        fields: ["r", "g", "b", "a"],
        value: pickNumericFields(value, ["r", "g", "b", "a"]),
      };
    }

    // Duck-typing for plain / engine objects (after node/component checks).
    if ("width" in value && "height" in value && !value.uuid) {
      if ("x" in value && "y" in value) {
        return {
          type: "rect",
          fields: ["x", "y", "width", "height"],
          value: pickNumericFields(value, ["x", "y", "width", "height"]),
        };
      }
      return {
        type: "size",
        fields: ["width", "height"],
        value: pickNumericFields(value, ["width", "height"]),
      };
    }
    if ("x" in value && "y" in value && "z" in value && "w" in value && !value.uuid) {
      return { type: "vec4", fields: ["x", "y", "z", "w"], value: pickNumericFields(value, ["x", "y", "z", "w"]) };
    }
    if ("x" in value && "y" in value && "z" in value && !value.uuid) {
      return { type: "vec3", fields: ["x", "y", "z"], value: pickNumericFields(value, ["x", "y", "z"]) };
    }
    if ("x" in value && "y" in value && !value.uuid && value._components === undefined) {
      return { type: "vec2", fields: ["x", "y"], value: pickNumericFields(value, ["x", "y"]) };
    }
    return null;
  }

  function isNodeReference(value) {
    if (!value || typeof value !== "object") return false;
    const name = ctorName(value);
    if (name === "Node" || name === "Scene" || name === "PrivateNode" || name === "cc.Node") {
      return true;
    }
    try {
      return !!(value.uuid && (Array.isArray(value._components) || Array.isArray(value.children)));
    } catch {
      return false;
    }
  }

  function isComponentReference(value) {
    if (!value || typeof value !== "object") return false;
    if (isNodeReference(value)) return false;
    try {
      if (value.node && isNodeReference(value.node)) return true;
    } catch {}
    const name = ctorName(value);
    if (!name || name === "Object" || name === "Array") return false;
    // Common Cocos component shape without walking prototypes.
    try {
      return value._id !== undefined && value.node != null;
    } catch {
      return false;
    }
  }

  function describeReferenceValue(value) {
    if (isNodeReference(value)) {
      let path = "";
      try {
        path = getNodePath(value);
      } catch {}
      return {
        type: "nodeRef",
        fields: null,
        value: {
          uuid: String(value.uuid || ""),
          name: String(value.name || "(unnamed)"),
          path,
        },
      };
    }
    if (isComponentReference(value)) {
      const owner = value.node;
      let componentName = "Component";
      try {
        componentName = getComponentDisplayName(value);
      } catch {}
      return {
        type: "componentRef",
        fields: null,
        value: {
          uuid: String(owner?.uuid || ""),
          name: String(owner?.name || "(unnamed)"),
          componentName,
          path: (() => {
            try {
              return owner ? getNodePath(owner) : "";
            } catch {
              return "";
            }
          })(),
        },
      };
    }
    return null;
  }

  function writeStructuredValue(targetValue, nextValue, fields) {
    if (!targetValue || typeof targetValue !== "object") return false;
    let wrote = false;
    for (const field of fields) {
      if (!(field in nextValue)) continue;
      const n = Number(nextValue[field]);
      if (!Number.isFinite(n)) continue;
      try {
        targetValue[field] = n;
        wrote = true;
      } catch {}
    }
    return wrote;
  }

  function assignPropValue(target, key, rawKey, nextValue, describedType, fields) {
    let wrote = false;
    const current = readTargetProp(target, key).value ?? readTargetProp(target, rawKey).value;

    if (fields?.length && current && typeof current === "object") {
      wrote = writeStructuredValue(current, nextValue, fields) || wrote;
      // Re-assign to trigger Cocos setters/dirty flags.
      try {
        target[key] = current;
        wrote = true;
      } catch {}
      try {
        if (rawKey && rawKey !== key) {
          target[rawKey] = current;
          wrote = true;
        }
      } catch {}
      return wrote;
    }

    try {
      target[key] = nextValue;
      wrote = true;
    } catch {}
    try {
      const privateKey = `_${key}`;
      if (Object.prototype.hasOwnProperty.call(target, privateKey)) {
        target[privateKey] = nextValue;
        wrote = true;
      }
    } catch {}
    try {
      if (rawKey && rawKey !== key) {
        target[rawKey] = nextValue;
        wrote = true;
      }
    } catch {}
    return wrote;
  }

  function collectPropertiesFromTarget(target, extraKeys = []) {
    const byName = new Map();
    const keys = new Set([...collectEditablePropKeys(target), ...extraKeys]);
    for (const key of keys) {
      if (!key || key.startsWith("__")) continue;
      const displayKey = normalizePropKey(key);
      if (!displayKey || EDITABLE_SKIP_KEYS.has(key) || EDITABLE_SKIP_KEYS.has(displayKey)) continue;
      if (displayKey === "node") continue;

      const read = readTargetProp(target, key);
      if (!read.ok) continue;
      const described = describeEditableValue(read.value);
      if (!described) continue;

      const existing = byName.get(displayKey);
      if (existing && existing.rawKey[0] !== "_" && key[0] === "_") continue;
      byName.set(displayKey, {
        key: displayKey,
        rawKey: read.rawKey || key,
        type: described.type,
        fields: described.fields || null,
        value: described.value,
      });
    }
    return Array.from(byName.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  function getComponentProperties(uuid, componentIndex) {
    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: "Node not found", properties: [] };
    const index = Number(componentIndex);
    if (!Number.isFinite(index) || index < 0) {
      return { ok: false, error: "Invalid component index", properties: [] };
    }
    const comp = node._components?.[index];
    if (!comp) return { ok: false, error: "Component not found", properties: [] };

    return {
      ok: true,
      componentName: getComponentDisplayName(comp),
      componentIndex: index,
      properties: collectPropertiesFromTarget(comp),
    };
  }

  function coerceIncomingValue(described, value) {
    if (!described) return { ok: false, error: "Unsupported property" };
    if (described.type === "number") {
      const nextValue = Number(value);
      if (!Number.isFinite(nextValue)) return { ok: false, error: "Invalid number" };
      return { ok: true, value: nextValue };
    }
    if (described.type === "boolean") {
      return {
        ok: true,
        value: value === true || value === "true" || value === 1 || value === "1",
      };
    }
    if (described.type === "string") {
      return { ok: true, value: value == null ? "" : String(value) };
    }
    if (described.fields?.length) {
      if (!value || typeof value !== "object") return { ok: false, error: "Expected vector/size object" };
      return { ok: true, value: pickNumericFields(value, described.fields) };
    }
    return { ok: false, error: `Unsupported type: ${described.type}` };
  }

  function setComponentProperty(uuid, componentIndex, key, value) {
    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: "Node not found" };
    const index = Number(componentIndex);
    const comp = node._components?.[index];
    if (!comp) return { ok: false, error: "Component not found" };

    const propKey = String(key || "").trim();
    if (!propKey) return { ok: false, error: "Property key required" };

    const currentRead =
      readTargetProp(comp, propKey).ok
        ? readTargetProp(comp, propKey)
        : readTargetProp(comp, `_${propKey}`);
    if (!currentRead?.ok) return { ok: false, error: `Property not found: ${propKey}` };

    const described = describeEditableValue(currentRead.value);
    const coerced = coerceIncomingValue(described, value);
    if (!coerced.ok) return coerced;

    const wrote = assignPropValue(
      comp,
      propKey,
      currentRead.rawKey,
      coerced.value,
      described.type,
      described.fields
    );
    if (!wrote) return { ok: false, error: "Failed to write property" };

    const verify = describeEditableValue(readTargetProp(comp, propKey).value);
    return {
      ok: true,
      key: propKey,
      type: described.type,
      fields: described.fields || null,
      value: verify ? verify.value : coerced.value,
    };
  }

  function getNodeProperties(uuid) {
    try {
      const node = getNodeByUuid(uuid);
      if (!node) return { ok: false, error: "Node not found", properties: [] };

      const properties = [];
      const push = (key, rawValue, rawKey = key) => {
        const described = describeEditableValue(rawValue);
        if (!described) return;
        properties.push({
          key,
          rawKey,
          type: described.type,
          fields: described.fields || null,
          value: described.value,
        });
      };

      try {
        push("name", String(node.name ?? ""));
      } catch {}
      try {
        // Scene has no meaningful active toggle in CC2.x — skip to avoid engine errors.
        if (!isSceneNode(node)) push("active", readNodeActive(node));
      } catch {}

      try {
        push("position", readNodePosition(node));
      } catch {
        push("position", { x: 0, y: 0, z: 0 });
      }

      try {
        push("scale", readNodeScale(node));
      } catch {
        push("scale", { x: 1, y: 1, z: 1 });
      }

      try {
        const euler = readNodeEulerAngles(node);
        if (euler) push("eulerAngles", euler);
      } catch {}

      try {
        const angle = readNodeAngle(node);
        if (typeof angle === "number") push("angle", angle);
      } catch {}

      try {
        if (typeof node.layer === "number") push("layer", node.layer);
      } catch {}

      return { ok: true, properties };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), properties: [] };
    }
  }

  function setNodeProperty(uuid, key, value) {
    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: "Node not found" };
    const propKey = String(key || "").trim();
    if (!propKey) return { ok: false, error: "Property key required" };

    try {
      if (propKey === "name") {
        node.name = String(value ?? "");
        return { ok: true, key: propKey, type: "string", value: node.name };
      }
      if (propKey === "active") {
        if (isSceneNode(node)) {
          return { ok: false, error: "Scene active cannot be changed" };
        }
        const next = value === true || value === "true" || value === 1 || value === "1";
        return { ok: true, key: propKey, type: "boolean", value: writeNodeActive(node, next) };
      }
      if (propKey === "layer") {
        const n = Number(value);
        if (!Number.isFinite(n)) return { ok: false, error: "Invalid number" };
        node.layer = n;
        return { ok: true, key: propKey, type: "number", value: node.layer };
      }
      if (propKey === "angle") {
        const n = Number(value);
        if (!Number.isFinite(n)) return { ok: false, error: "Invalid number" };
        try {
          node.angle = n;
        } catch {
          try {
            if (node._eulerAngles) {
              node._eulerAngles.z = n;
              if (typeof node._fromEuler === "function") node._fromEuler();
            }
          } catch {}
        }
        return { ok: true, key: propKey, type: "number", value: readNodeAngle(node) ?? n };
      }
      if (propKey === "position" || propKey === "scale" || propKey === "eulerAngles") {
        const fields = ["x", "y", "z"];
        const next = pickNumericFields(value || {}, fields);
        if (propKey === "position") {
          if (typeof node.setPosition === "function") node.setPosition(next.x, next.y, next.z);
          else if (node._position) writeStructuredValue(node._position, next, fields);
          else if (node.position && typeof node.position === "object") {
            writeStructuredValue(node.position, next, fields);
          } else {
            node.x = next.x;
            node.y = next.y;
            node.z = next.z;
          }
        } else if (propKey === "scale") {
          if (typeof node.setScale === "function") node.setScale(next.x, next.y, next.z);
          else if (node._scale) writeStructuredValue(node._scale, next, fields);
          else if (node.scale && typeof node.scale === "object") {
            writeStructuredValue(node.scale, next, fields);
          }
        } else if (propKey === "eulerAngles") {
          writeNodeEulerAngles(node, next);
        }
        const latest = getNodeProperties(uuid);
        const prop = latest.properties?.find((item) => item.key === propKey);
        return {
          ok: true,
          key: propKey,
          type: "vec3",
          fields,
          value: prop?.value || next,
        };
      }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }

    return { ok: false, error: `Unsupported node property: ${propKey}` };
  }

  function toggleActive(uuid) {
    const node = getNodeByUuid(uuid);
    if (!node) return false;
    if (isSceneNode(node)) return true;
    return writeNodeActive(node, !readNodeActive(node));
  }

  function setActive(uuid, active) {
    const node = getNodeByUuid(uuid);
    if (!node) return false;
    if (isSceneNode(node)) return true;
    return writeNodeActive(node, !!active);
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
      key === "scale" ||
      key === "rotation" ||
      key === "rotationX" ||
      key === "rotationY" ||
      key === "_rotationX" ||
      key === "_rotationY"
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

  function isSkeletonLikeComponent(comp) {
    if (!comp) return false;
    const ctorName = comp.constructor?.name || "";
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
  }

  function findSpineComponent(node, componentIndex = null) {
    const comps = node?._components || [];
    const index = Number(componentIndex);
    if (Number.isFinite(index) && index >= 0 && isSkeletonLikeComponent(comps[index])) {
      return comps[index];
    }
    return comps.find((comp) => isSkeletonLikeComponent(comp)) || null;
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

  function getRuntimeSkeleton(spine) {
    if (!spine) return null;
    return (
      spine._skeleton ||
      spine._sgNode?._skeleton ||
      spine._skeletonComp?._skeleton ||
      spine.skeleton ||
      spine._internalSkeleton ||
      spine._armature ||
      spine.armature ||
      null
    );
  }

  function getSkeletonBones(runtime) {
    if (!runtime) return [];
    if (Array.isArray(runtime.bones)) return runtime.bones;
    try {
      if (typeof runtime.getBones === "function") {
        const bones = runtime.getBones();
        if (Array.isArray(bones)) return bones;
      }
    } catch {}
    if (Array.isArray(runtime._bones)) return runtime._bones;
    return [];
  }

  function getBoneName(bone) {
    if (!bone) return "";
    return String(bone.data?.name || bone.name || "");
  }

  function getSkeletonComponent(node, componentIndex) {
    return findSpineComponent(node, componentIndex);
  }

  function serializeBoneTree(bones) {
    const items = [];
    const byRef = new Map();
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const name = getBoneName(bone) || `bone_${i}`;
      const item = { name, index: i, children: [] };
      items.push(item);
      byRef.set(bone, item);
    }
    const roots = [];
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const item = items[i];
      const parent = bone?.parent || null;
      if (parent && parent !== bone && byRef.has(parent)) {
        byRef.get(parent).children.push(item);
      } else {
        roots.push(item);
      }
    }
    return roots;
  }

  function getSkeletonBoneTree(nodeUuid, componentIndex = null) {
    const uuid = String(nodeUuid || "").trim();
    if (!uuid) return { ok: false, error: "Node UUID is required", bones: [] };

    const node = getNodeByUuid(uuid);
    if (!node) return { ok: false, error: `Node not found for UUID: ${uuid}`, bones: [] };

    const spine = getSkeletonComponent(node, componentIndex);
    if (!spine) {
      return { ok: false, error: "Selected node has no Spine/Skeleton component", bones: [] };
    }

    const runtime = getRuntimeSkeleton(spine);
    const bones = getSkeletonBones(runtime);
    if (!bones.length) {
      return { ok: false, error: "Skeleton has no bones (not initialized yet?)", bones: [] };
    }

    const tree = serializeBoneTree(bones);
    return {
      ok: true,
      nodeUuid: uuid,
      nodeName: node.name || "(unnamed)",
      componentName: getComponentDisplayName(spine),
      boneCount: bones.length,
      bones: tree,
    };
  }

  function findBoneByName(runtime, boneName) {
    const name = String(boneName || "");
    if (!runtime || !name) return null;
    try {
      if (typeof runtime.findBone === "function") {
        const found = runtime.findBone(name);
        if (found) return found;
      }
    } catch {}
    const bones = getSkeletonBones(runtime);
    return bones.find((bone) => getBoneName(bone) === name) || null;
  }

  function ensureRuntimeWorldUpToDate(spine, runtime) {
    if (!runtime && !spine) return;
    try {
      if (spine && typeof spine._updateSkeleton === "function") {
        spine._updateSkeleton();
      }
    } catch {}
    try {
      if (spine && typeof spine.updateWorldTransform === "function") {
        spine.updateWorldTransform();
      }
    } catch {}
    try {
      if (runtime && typeof runtime.updateWorldTransform === "function") {
        runtime.updateWorldTransform();
      }
    } catch {}
  }

  function spineDegToRad(deg) {
    return (Number(deg) || 0) * (Math.PI / 180);
  }

  // Spine bone world position in skeleton space (not screen).
  // Uses only fields present on spine-ts Bone: worldX/worldY, x/y, ax/ay, a/b/c/d.
  function getBoneSkeletonPoint(bone, runtime) {
    if (!bone) return { x: 0, y: 0 };
    ensureRuntimeWorldUpToDate(null, runtime);

    const wx = bone.worldX;
    const wy = bone.worldY;
    if (typeof wx === "number" && typeof wy === "number" && bone.appliedValid !== false) {
      const lx = Number(bone.ax ?? bone.x ?? 0) || 0;
      const ly = Number(bone.ay ?? bone.y ?? 0) || 0;
      const hasLocalOffset = lx !== 0 || ly !== 0;
      // Root at (0,0) is valid. For child bones with local offset, ignore stale worldX/worldY=0.
      if (!bone.parent || !hasLocalOffset || wx !== 0 || wy !== 0) {
        return { x: wx, y: wy };
      }
    }

    // Manual world transform when runtime hasn't populated worldX/worldY yet.
    const chain = [];
    let curr = bone;
    while (curr) {
      chain.unshift(curr);
      curr = curr.parent || null;
    }

    let pa = 1;
    let pb = 0;
    let pc = 0;
    let pd = 1;
    let worldX = 0;
    let worldY = 0;

    for (const item of chain) {
      const lx = Number(item.ax ?? item.x ?? 0) || 0;
      const ly = Number(item.ay ?? item.y ?? 0) || 0;
      const rot = Number(item.arotation ?? item.rotation ?? 0) || 0;
      const sx = Number(item.ascaleX ?? item.scaleX ?? 1) || 1;
      const sy = Number(item.ascaleY ?? item.scaleY ?? 1) || 1;
      const shearX = Number(item.ashearX ?? item.shearX ?? 0) || 0;
      const shearY = Number(item.ashearY ?? item.shearY ?? 0) || 0;

      const rad = spineDegToRad(rot + shearY);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const a = cos * sx;
      const b = sin * sx;
      const c = -sin * sy + cos * shearX * sy;
      const d = cos * sy + sin * shearX * sy;

      const na = pa * a + pb * c;
      const nb = pa * b + pb * d;
      const nc = pc * a + pd * c;
      const nd = pc * b + pd * d;
      worldX = pa * lx + pc * ly + worldX;
      worldY = pb * lx + pd * ly + worldY;
      pa = na;
      pb = nb;
      pc = nc;
      pd = nd;
    }

    return { x: worldX, y: worldY };
  }

  function getBoneSkeletonTip(bone, runtime) {
    const origin = getBoneSkeletonPoint(bone, runtime);
    const length = Number(bone?.data?.length ?? 0) || 0;

    if (length > 0 && typeof bone.a === "number" && typeof bone.c === "number") {
      return {
        x: origin.x + bone.a * length,
        y: origin.y + bone.c * length,
      };
    }

    if (length > 0) {
      const rot = Number(bone.arotation ?? bone.rotation ?? 0) || 0;
      const rad = spineDegToRad(rot);
      return {
        x: origin.x + Math.cos(rad) * length,
        y: origin.y + Math.sin(rad) * length,
      };
    }

    const firstChild = Array.isArray(bone?.children) ? bone.children[0] : null;
    if (firstChild) {
      return getBoneSkeletonPoint(firstChild, runtime);
    }

    return origin;
  }

  function skeletonPointToNodeWorld(spine, node, point) {
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;

    // CC2 sp.Skeleton often exposes node-space conversion helpers.
    try {
      if (typeof spine?.convertToWorldSpace === "function") {
        const cc = getCocos();
        const local = cc?.v2 ? cc.v2(x, y) : { x, y };
        const ret = spine.convertToWorldSpace(local);
        if (ret && Number.isFinite(ret.x) && Number.isFinite(ret.y)) {
          return { x: ret.x, y: ret.y };
        }
      }
    } catch {}

    try {
      if (typeof spine?.node?.convertToWorldSpaceAR === "function") {
        const cc = getCocos();
        const local = cc?.v2 ? cc.v2(x, y) : makeVec3(x, y, 0);
        const ret = spine.node.convertToWorldSpaceAR(local);
        if (ret && Number.isFinite(ret.x) && Number.isFinite(ret.y)) {
          return { x: ret.x, y: ret.y };
        }
      }
    } catch {}

    const anchor = spine?.node || node;
    return localToWorld(anchor, { x, y });
  }

  function applySpineTimeScale(cc, numericSpeed) {
    const spNs = cc?.sp || window.sp || null;
    if (!spNs) return { applied: false, method: "" };

    // Global Spine playback rate (separate from scheduler timeScale).
    try {
      if ("timeScale" in spNs) {
        if (spNs.__animTracerBaseTimeScale == null) {
          const current = Number(spNs.timeScale);
          spNs.__animTracerBaseTimeScale = Number.isFinite(current) ? current : 1;
        }
        spNs.timeScale = (spNs.__animTracerBaseTimeScale || 1) * numericSpeed;
        return { applied: true, method: "sp.timeScale" };
      }
    } catch {}

    // Fallback: scale dt inside Skeleton.update without overwriting per-skeleton timeScale.
    const Skeleton = spNs.Skeleton;
    const proto = Skeleton?.prototype;
    if (proto && typeof proto.update === "function") {
      if (!proto.__animTracerOriginalUpdate) {
        proto.__animTracerOriginalUpdate = proto.update;
        proto.update = function (dt) {
          const mul = bridgeGameSpeed || 1;
          return proto.__animTracerOriginalUpdate.call(this, dt * mul);
        };
        proto.__animTracerOriginalUpdate.__animTracerWrapped = true;
      }
      return { applied: true, method: "Skeleton.update" };
    }

    return { applied: false, method: "" };
  }

  function setGameSpeedCocos2x(cc, numericSpeed) {
    const director = cc?.director;
    const methods = [];
    let ok = false;

    const scheduler =
      (typeof director?.getScheduler === "function" ? director.getScheduler() : null) ||
      director?._scheduler ||
      null;

    if (scheduler && typeof scheduler.setTimeScale === "function") {
      scheduler.setTimeScale(numericSpeed);
      methods.push("scheduler.setTimeScale");
      ok = true;
    }

    // Spine in CC2.x often does NOT follow scheduler timeScale (especially cache /
    // custom update paths). It uses sp.timeScale / skeleton update instead.
    const spineResult = applySpineTimeScale(cc, numericSpeed);
    if (spineResult.applied) {
      methods.push(spineResult.method);
      ok = true;
    }

    if (!ok) {
      const game = cc?.game;
      if (game && typeof game.update === "function" && !game.__animTracerOriginalUpdate) {
        game.__animTracerOriginalUpdate = game.update.bind(game);
        game.update = function (dt) {
          return game.__animTracerOriginalUpdate(dt * (bridgeGameSpeed || 1));
        };
      }
      if (game?.__animTracerOriginalUpdate) {
        methods.push("game.update");
        ok = true;
      }
    }

    if (!ok) {
      return { ok: false, error: "Cocos 2.x game speed APIs not available" };
    }

    bridgeGameSpeed = numericSpeed;
    if (director) director.__animTracerGameSpeed = numericSpeed;
    return {
      ok: true,
      speed: numericSpeed,
      engine: "2.x",
      method: methods.join(" + "),
    };
  }

  function setGameSpeedCocos3x(cc, numericSpeed) {
    const director = cc?.director;
    if (!director) return { ok: false, error: "Cocos director not found" };

    const originalTick = director._originalTick ?? director.tick?.bind(director);
    if (typeof originalTick !== "function") {
      // Some 3.x builds expose scheduler time scale too.
      const scheduler =
        (typeof director.getScheduler === "function" ? director.getScheduler() : null) ||
        director._scheduler;
      if (scheduler && typeof scheduler.setTimeScale === "function") {
        scheduler.setTimeScale(numericSpeed);
        bridgeGameSpeed = numericSpeed;
        director.__animTracerGameSpeed = numericSpeed;
        return { ok: true, speed: numericSpeed, engine: "3.x", method: "scheduler.setTimeScale" };
      }
      return { ok: false, error: "director.tick is not available" };
    }

    if (!director._originalTick) {
      director._originalTick = originalTick;
    }

    director.tick = (dt, ...args) => {
      originalTick(dt * numericSpeed, ...args);
    };
    bridgeGameSpeed = numericSpeed;
    director.__animTracerGameSpeed = numericSpeed;
    return { ok: true, speed: numericSpeed, engine: "3.x", method: "director.tick" };
  }

  function setGameSpeed(speed) {
    const cc = getCocos();
    if (!cc?.director) return { ok: false, error: "Cocos director not found" };

    const numericSpeed = Number(speed);
    if (!Number.isFinite(numericSpeed) || numericSpeed <= 0) {
      return { ok: false, error: "Speed must be greater than 0" };
    }

    const result = isCocos2x(cc)
      ? setGameSpeedCocos2x(cc, numericSpeed)
      : setGameSpeedCocos3x(cc, numericSpeed);
    if (result?.ok) {
      notifyGameSpeedChanged(result.speed);
    }
    return result;
  }

  function getGameSpeed() {
    const cc = getCocos();
    const director = cc?.director;
    if (!director) return { ok: false, speed: 1 };

    if (isCocos2x(cc)) {
      try {
        const scheduler =
          (typeof director.getScheduler === "function" ? director.getScheduler() : null) ||
          director._scheduler;
        if (scheduler && typeof scheduler.getTimeScale === "function") {
          const scale = Number(scheduler.getTimeScale());
          if (Number.isFinite(scale) && scale > 0) {
            bridgeGameSpeed = scale;
            return { ok: true, speed: scale, engine: "2.x" };
          }
        }
      } catch {}
    }

    const stored = Number(director.__animTracerGameSpeed ?? bridgeGameSpeed ?? 1);
    return {
      ok: true,
      speed: Number.isFinite(stored) && stored > 0 ? stored : 1,
      engine: isCocos2x(cc) ? "2.x" : "3.x",
    };
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
      notifyPauseStateChanged(bridgePaused);
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

  function getNodeEventTypeEnum(cc = getCocos()) {
    return cc?.Node?.EventType || window.cc?.Node?.EventType || null;
  }

  function getNodeBreakCatalogItem(eventType) {
    const type = String(eventType || "").trim().toLowerCase();
    const normalized = NODE_BREAK_EVENT_ALIASES[type] || type;
    return NODE_BREAK_EVENT_CATALOG.find((item) => item.id === normalized) || null;
  }

  function resolveNodeBreakEngineKey(eventType, cc = getCocos()) {
    const item = getNodeBreakCatalogItem(eventType);
    if (!item) return { ok: false, error: `Unsupported event type: ${String(eventType || "")}` };
    const spec = isCocos2x(cc) ? item.v2 : item.v3;
    if (!spec.enabled) {
      const engine = isCocos2x(cc) ? "Cocos 2.x" : "Cocos 3.x";
      return { ok: false, id: item.id, label: item.label, error: `${item.label} is not emitted on ${engine}` };
    }
    let engineKey = "";
    try {
      engineKey = String(spec.key(getNodeEventTypeEnum(cc)) || "").trim();
    } catch {
      engineKey = "";
    }
    if (!engineKey) {
      return { ok: false, id: item.id, label: item.label, error: `Engine event key missing for ${item.label}` };
    }
    return { ok: true, id: item.id, label: item.label, engineKey };
  }

  function normalizeNodeBreakEventType(eventType) {
    const item = getNodeBreakCatalogItem(eventType);
    return item ? item.id : "";
  }

  function normalizeBreakUuid(uuid) {
    const id = String(uuid || "").trim();
    return id || "*";
  }

  function collectSceneNodes() {
    const scene = getCocos()?.director?.getScene?.();
    const nodes = [];
    const stack = scene ? [scene] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.name !== "__AnimTracerHL__") nodes.push(node);
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return nodes;
  }

  function makeNodeEventBreakListener(eventType, engineKey, node) {
    return function animTracerNodeEventBreak(...args) {
      eval("console.log('[AnimTracer] node event', eventType, engineKey, node, args); debugger;");
    };
  }

  function attachBreakToNode(entry, node) {
    if (!entry?.engineKey || !node || node.name === "__AnimTracerHL__") return false;
    if (node.isValid === false) return false;
    if (typeof node.on !== "function") return false;
    if (entry.listeners.some((item) => item.node === node)) return true;
    const fn = makeNodeEventBreakListener(entry.eventType, entry.engineKey, node);
    try {
      node.on(entry.engineKey, fn);
    } catch {
      return false;
    }
    entry.listeners.push({ node, fn, key: entry.engineKey });
    return true;
  }

  function detachBreakListeners(entry) {
    if (!entry?.listeners?.length) {
      if (entry) entry.listeners = [];
      return;
    }
    for (const item of entry.listeners) {
      try {
        if (item.node && item.node.isValid !== false && typeof item.node.off === "function") {
          item.node.off(item.key, item.fn);
        }
      } catch {}
    }
    entry.listeners = [];
  }

  function nodesForBreakUuid(uuid) {
    if (uuid === "*") return collectSceneNodes();
    const node = getNodeByUuid(uuid);
    return node ? [node] : [];
  }

  function serializeBreakEntry(entry, index) {
    return {
      id: index,
      uuid: entry.uuid,
      eventType: entry.eventType,
      label: entry.label || entry.eventType,
      engineKey: entry.engineKey || "",
      listenerCount: entry.listeners?.length || 0,
    };
  }

  function getNodeEventBreakTypes() {
    const cc = getCocos();
    if (!cc) return { ok: false, error: "Cocos runtime not found (window.cc)", types: [] };
    const engine = isCocos2x(cc) ? "2.x" : "3.x";
    const types = NODE_BREAK_EVENT_CATALOG.map((item) => {
      const resolved = resolveNodeBreakEngineKey(item.id, cc);
      return {
        id: item.id,
        label: item.label,
        enabled: !!resolved.ok,
        engineKey: resolved.engineKey || "",
      };
    });
    return { ok: true, engine, types };
  }

  function getNodeEventBreaks() {
    return {
      ok: true,
      breaks: nodeEventBreakpoints.map((entry, index) => serializeBreakEntry(entry, index)),
    };
  }

  function syncNodeEventBreaks() {
    for (const entry of nodeEventBreakpoints) {
      entry.listeners = (entry.listeners || []).filter((item) => item.node && item.node.isValid !== false);
      for (const node of nodesForBreakUuid(entry.uuid)) {
        attachBreakToNode(entry, node);
      }
    }
  }

  function registerNodeEventBreak(uuid, eventType) {
    const resolved = resolveNodeBreakEngineKey(eventType);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error || `Unsupported event type: ${String(eventType || "")}` };
    }
    const normalizedUuid = normalizeBreakUuid(uuid);
    if (normalizedUuid !== "*") {
      const node = getNodeByUuid(normalizedUuid);
      if (!node) return { ok: false, error: `Node not found for UUID: ${normalizedUuid}` };
      if (typeof node.on !== "function") {
        return { ok: false, error: "Node.on is not available on this engine build" };
      }
    }
    const exists = nodeEventBreakpoints.find(
      (entry) => entry.uuid === normalizedUuid && entry.eventType === resolved.id
    );
    if (exists) {
      for (const node of nodesForBreakUuid(normalizedUuid)) {
        attachBreakToNode(exists, node);
      }
      return {
        ok: true,
        added: false,
        break: serializeBreakEntry(exists, nodeEventBreakpoints.indexOf(exists)),
        breaks: nodeEventBreakpoints.map((entry, index) => serializeBreakEntry(entry, index)),
      };
    }
    const entry = {
      uuid: normalizedUuid,
      eventType: resolved.id,
      label: resolved.label,
      engineKey: resolved.engineKey,
      listeners: [],
    };
    const nodes = nodesForBreakUuid(normalizedUuid);
    if (!nodes.length) {
      return { ok: false, error: normalizedUuid === "*" ? "No active scene" : `Node not found for UUID: ${normalizedUuid}` };
    }
    let attached = 0;
    for (const node of nodes) {
      if (attachBreakToNode(entry, node)) attached += 1;
    }
    if (!attached) {
      return { ok: false, error: `Failed to listen for ${resolved.label}` };
    }
    nodeEventBreakpoints.push(entry);
    return {
      ok: true,
      added: true,
      break: serializeBreakEntry(entry, nodeEventBreakpoints.length - 1),
      breaks: nodeEventBreakpoints.map((item, index) => serializeBreakEntry(item, index)),
    };
  }

  function clearNodeEventBreaks(uuid = null, eventType = null) {
    const normalizedUuid = uuid == null ? null : normalizeBreakUuid(uuid);
    const normalizedType = eventType == null ? null : normalizeNodeBreakEventType(eventType);
    if (eventType != null && !normalizedType) {
      return { ok: false, error: `Unsupported event type: ${String(eventType || "")}` };
    }
    const before = nodeEventBreakpoints.length;
    for (let i = nodeEventBreakpoints.length - 1; i >= 0; i--) {
      const entry = nodeEventBreakpoints[i];
      if (normalizedUuid != null && entry.uuid !== normalizedUuid) continue;
      if (normalizedType != null && entry.eventType !== normalizedType) continue;
      detachBreakListeners(entry);
      nodeEventBreakpoints.splice(i, 1);
    }
    return {
      ok: true,
      cleared: before - nodeEventBreakpoints.length,
      breaks: nodeEventBreakpoints.map((entry, index) => serializeBreakEntry(entry, index)),
    };
  }

  const HIGHLIGHT_STYLE_ID = "__animtracer-highlight-style__";
  const HIGHLIGHT_EL_ID = "__animtracer-node-highlight__";
  const BONE_HIGHLIGHT_EL_ID = "__animtracer-bone-highlight__";
  let highlightRaf = 0;
  let highlightUuid = null;
  let highlightKind = null;
  let highlightBoneName = null;
  let highlightComponentIndex = null;

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
          return camComp?.camera || camComp || comp._camera || comp;
        }
        if (name === "Camera" || name === "cc.Camera") {
          return comp.camera || comp._camera || comp;
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

  function getWorldToScreenFn(camera) {
    if (!camera) return null;
    if (typeof camera.worldToScreen === "function") return camera.worldToScreen.bind(camera);
    if (typeof camera.getWorldToScreenPoint === "function") return camera.getWorldToScreenPoint.bind(camera);
    return null;
  }

  function callWorldToScreen(camera, x, y, order) {
    const fn = getWorldToScreenFn(camera);
    if (!fn) return null;
    const world = makeVec3(x, y, 0);
    const out = makeVec3(0, 0, 0);
    try {
      const ret = order === "worldFirst" ? fn(world, out) : fn(out, world);
      const p = ret && typeof ret.x === "number" ? ret : out;
      if (!Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return null;
      return { x: Number(p.x), y: Number(p.y) };
    } catch {
      return null;
    }
  }

  // Wrong worldToScreen arg order projects (0,0,0) → canvas bottom-left.
  // Pick the order that actually separates two nearby world points.
  function pickWorldToScreenOrder(camera, x, y) {
    const probe = (order) => {
      const a = callWorldToScreen(camera, x, y, order);
      const b = callWorldToScreen(camera, x + 80, y + 50, order);
      if (!a || !b) return -1;
      return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    };
    const worldFirst = probe("worldFirst");
    const outFirst = probe("outFirst");
    if (worldFirst < 0 && outFirst < 0) return null;
    return worldFirst >= outFirst ? "worldFirst" : "outFirst";
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
        const p = callWorldToScreen(camera, x, y, order);
        if (!p) return null;
        points.push(p);
      }
      return points;
    };

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
    if (camera && getWorldToScreenFn(camera)) {
      const points = projectWorldCorners(camera, rect);
      if (points) {
        const { minX, minY, maxX, maxY, spread } = screenSpread(points);
        if (spread > 2) {
          // Cocos camera.worldToScreen uses bottom-left origin; CSS uses top-left.
          return {
            left: canvasRect.left + minX * scaleX,
            top: canvasRect.top + (bufferH - maxY) * scaleY,
            width: Math.max((maxX - minX) * scaleX, 2),
            height: Math.max((maxY - minY) * scaleY, 2),
          };
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
        #${BONE_HIGHLIGHT_EL_ID} {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2147483646;
          display: none;
        }
        #${BONE_HIGHLIGHT_EL_ID} svg {
          width: 100%;
          height: 100%;
          overflow: visible;
        }
        #${BONE_HIGHLIGHT_EL_ID} line {
          stroke: #ff4d6d;
          stroke-width: 3;
          stroke-linecap: round;
        }
        #${BONE_HIGHLIGHT_EL_ID} circle.joint {
          fill: #ff4d6d;
          stroke: #fff;
          stroke-width: 2;
        }
        #${BONE_HIGHLIGHT_EL_ID} circle.tip {
          fill: #fff;
          stroke: #ff4d6d;
          stroke-width: 2;
        }
        #${BONE_HIGHLIGHT_EL_ID} .animtracer-bone-label {
          position: absolute;
          max-width: 240px;
          overflow: hidden;
          text-overflow: ellipsis;
          font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #fff;
          background: #ff4d6d;
          padding: 0 5px;
          white-space: nowrap;
          border-radius: 2px;
          transform: translate(-50%, calc(-100% - 8px));
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

  function hideNodeHighlightEl() {
    const el = document.getElementById(HIGHLIGHT_EL_ID);
    if (el) el.style.display = "none";
  }

  function hideBoneHighlightEl() {
    const el = document.getElementById(BONE_HIGHLIGHT_EL_ID);
    if (el) el.style.display = "none";
  }

  function stopHighlightLoop() {
    if (highlightRaf) {
      cancelAnimationFrame(highlightRaf);
      highlightRaf = 0;
    }
  }

  function startHighlightLoop() {
    stopHighlightLoop();
    highlightRaf = requestAnimationFrame(updateHighlightFrame);
  }

  function localToWorld(node, local) {
    const x = Number(local?.x) || 0;
    const y = Number(local?.y) || 0;
    const ui = getUITransform(node);
    if (ui?.convertToWorldSpaceAR) {
      try {
        const out = makeVec3(0, 0, 0);
        const ret = ui.convertToWorldSpaceAR(makeVec3(x, y, 0), out) || out;
        if (ret && Number.isFinite(ret.x) && Number.isFinite(ret.y)) {
          return { x: ret.x, y: ret.y };
        }
      } catch {}
    }
    try {
      if (typeof node.convertToWorldSpaceAR === "function") {
        const cc = getCocos();
        const vec = cc?.v2 ? cc.v2(x, y) : makeVec3(x, y, 0);
        const ret = node.convertToWorldSpaceAR(vec);
        if (ret && Number.isFinite(ret.x) && Number.isFinite(ret.y)) {
          return { x: ret.x, y: ret.y };
        }
      }
    } catch {}
    try {
      if (typeof node.getWorldMatrix === "function") {
        const cc = getCocos();
        const Mat4 = cc?.math?.Mat4 || cc?.Mat4;
        const Vec3 = cc?.math?.Vec3 || cc?.Vec3;
        if (typeof Mat4 === "function" && typeof Vec3 === "function") {
          const mat = new Mat4();
          node.getWorldMatrix(mat);
          const out = new Vec3();
          if (typeof Vec3.transformMat4 === "function") {
            Vec3.transformMat4(out, new Vec3(x, y, 0), mat);
          } else if (typeof mat.transformPoint === "function") {
            mat.transformPoint(out, new Vec3(x, y, 0));
          }
          if (Number.isFinite(out.x) && Number.isFinite(out.y)) {
            return { x: out.x, y: out.y };
          }
        }
      }
    } catch {}
    let wp = null;
    try {
      wp = node.worldPosition;
      if (!wp && typeof node.getWorldPosition === "function") wp = node.getWorldPosition();
    } catch {}
    wp = wp || { x: 0, y: 0 };
    return { x: (Number(wp.x) || 0) + x, y: (Number(wp.y) || 0) + y };
  }

  function worldPointToCss(x, y, node) {
    const wx = Number(x);
    const wy = Number(y);
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;

    // Reuse the node-highlight projector: a tiny world rect around the bone.
    // worldRectToCss already picks the correct worldToScreen argument order.
    const probe = 24;
    const css = worldRectToCss(
      { x: wx - probe / 2, y: wy - probe / 2, width: probe, height: probe },
      node
    );
    if (css) {
      return {
        x: css.left + css.width / 2,
        y: css.top + css.height / 2,
      };
    }

    const canvas = getGameCanvas();
    if (!canvas) return null;
    const canvasRect = canvas.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) return null;

    const bufferW = canvas.width || canvasRect.width;
    const bufferH = canvas.height || canvasRect.height;
    const scaleX = canvasRect.width / bufferW;
    const scaleY = canvasRect.height / bufferH;

    const camera = findCameraForNode(node);
    const order = camera ? pickWorldToScreenOrder(camera, wx, wy) : null;
    const pick = order ? callWorldToScreen(camera, wx, wy, order) : null;
    if (pick) {
      return {
        x: canvasRect.left + pick.x * scaleX,
        y: canvasRect.top + (bufferH - pick.y) * scaleY,
      };
    }

    const cc = getCocos();
    const view = cc?.view;
    const visible = view?.getVisibleSize?.() || { width: canvasRect.width, height: canvasRect.height };
    const origin = view?.getVisibleOrigin?.() || { x: 0, y: 0 };
    const sx = canvasRect.width / (visible.width || 1);
    const sy = canvasRect.height / (visible.height || 1);
    return {
      x: canvasRect.left + (wx - origin.x) * sx,
      y: canvasRect.top + (visible.height - (wy - origin.y)) * sy,
    };
  }

  function getBoneLocalPoint(bone, runtime) {
    return getBoneSkeletonPoint(bone, runtime);
  }

  function getBoneTipLocal(bone, runtime) {
    return getBoneSkeletonTip(bone, runtime);
  }

  function ensureBoneHighlightEl() {
    ensureHighlightEl();
    let el = document.getElementById(BONE_HIGHLIGHT_EL_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BONE_HIGHLIGHT_EL_ID;
      el.innerHTML = `
        <svg>
          <line class="shaft" x1="0" y1="0" x2="0" y2="0"></line>
          <circle class="joint" cx="0" cy="0" r="6"></circle>
          <circle class="tip" cx="0" cy="0" r="3"></circle>
        </svg>
        <div class="animtracer-bone-label"></div>
      `;
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function updateNodeHighlightFrame() {
    const node = getNodeByUuid(highlightUuid);
    const el = ensureHighlightEl();
    hideBoneHighlightEl();
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
  }

  function updateBoneHighlightFrame() {
    hideNodeHighlightEl();
    const el = ensureBoneHighlightEl();
    const node = getNodeByUuid(highlightUuid);
    if (!node || node.isValid === false) {
      el.style.display = "none";
      return;
    }

    const spine = getSkeletonComponent(node, highlightComponentIndex);
    const runtime = getRuntimeSkeleton(spine);
    ensureRuntimeWorldUpToDate(spine, runtime);
    const bone = findBoneByName(runtime, highlightBoneName);
    if (!bone) {
      el.style.display = "none";
      return;
    }

    const originLocal = getBoneSkeletonPoint(bone, runtime);
    const tipLocal = getBoneSkeletonTip(bone, runtime);
    const originWorld = skeletonPointToNodeWorld(spine, node, originLocal);
    const tipWorld = skeletonPointToNodeWorld(spine, node, tipLocal);
    const originCss = worldPointToCss(originWorld.x, originWorld.y, node);
    const tipCss = worldPointToCss(tipWorld.x, tipWorld.y, node);
    if (!originCss || !tipCss) {
      el.style.display = "none";
      return;
    }

    el.style.display = "block";
    const svg = el.querySelector("svg");
    if (svg) {
      const w = window.innerWidth || document.documentElement.clientWidth || 0;
      const h = window.innerHeight || document.documentElement.clientHeight || 0;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    const line = el.querySelector("line.shaft");
    const joint = el.querySelector("circle.joint");
    const tip = el.querySelector("circle.tip");
    const label = el.querySelector(".animtracer-bone-label");
    if (line) {
      line.setAttribute("x1", String(originCss.x));
      line.setAttribute("y1", String(originCss.y));
      line.setAttribute("x2", String(tipCss.x));
      line.setAttribute("y2", String(tipCss.y));
    }
    if (joint) {
      joint.setAttribute("cx", String(originCss.x));
      joint.setAttribute("cy", String(originCss.y));
    }
    if (tip) {
      tip.setAttribute("cx", String(tipCss.x));
      tip.setAttribute("cy", String(tipCss.y));
    }
    if (label) {
      label.textContent = highlightBoneName || getBoneName(bone) || "bone";
      label.style.left = `${originCss.x}px`;
      label.style.top = `${originCss.y}px`;
    }
  }

  function updateHighlightFrame() {
    if (highlightKind === "bone" && highlightUuid && highlightBoneName) {
      updateBoneHighlightFrame();
    } else if (highlightKind === "node" && highlightUuid) {
      updateNodeHighlightFrame();
    } else {
      hideNodeHighlightEl();
      hideBoneHighlightEl();
      return;
    }
    highlightRaf = requestAnimationFrame(updateHighlightFrame);
  }

  function highlightNode(uuid) {
    const id = String(uuid || "").trim();
    if (!id) return { ok: false, error: "UUID required" };
    const node = getNodeByUuid(id);
    if (!node) return { ok: false, error: "Node not found" };

    highlightKind = "node";
    highlightUuid = id;
    highlightBoneName = null;
    highlightComponentIndex = null;
    startHighlightLoop();
    return { ok: true, name: node.name || "(unnamed)" };
  }

  function highlightSkeletonBone(nodeUuid, boneName, componentIndex = null) {
    const id = String(nodeUuid || "").trim();
    const name = String(boneName || "").trim();
    if (!id) return { ok: false, error: "UUID required" };
    if (!name) return { ok: false, error: "Bone name required" };
    const node = getNodeByUuid(id);
    if (!node) return { ok: false, error: "Node not found" };
    const spine = getSkeletonComponent(node, componentIndex);
    if (!spine) return { ok: false, error: "No Spine/Skeleton component" };
    const bone = findBoneByName(getRuntimeSkeleton(spine), name);
    if (!bone) return { ok: false, error: `Bone not found: ${name}` };

    highlightKind = "bone";
    highlightUuid = id;
    highlightBoneName = name;
    highlightComponentIndex = Number.isFinite(Number(componentIndex)) ? Number(componentIndex) : null;
    startHighlightLoop();
    return { ok: true, name };
  }

  function clearNodeHighlight() {
    highlightKind = null;
    highlightUuid = null;
    highlightBoneName = null;
    highlightComponentIndex = null;
    stopHighlightLoop();
    hideNodeHighlightEl();
    hideBoneHighlightEl();
    return { ok: true };
  }

  function clearSkeletonBoneHighlight() {
    if (highlightKind !== "bone") return { ok: true };
    return clearNodeHighlight();
  }

  const SPEED_PANEL_STYLE_ID = "animtracer-speed-panel-style";
  const SPEED_PANEL_ID = "animtracer-speed-panel";
  const SPEED_PANEL_TAB_ID = "animtracer-speed-panel-tab";
  const SPEED_PANEL_STORAGE_KEY = "animtracer-speed-panel";

  let speedPanelRefs = null;
  let speedPanelEnabled = true;
  let speedPanelCollapsed = false;

  function clampGameSpeedValue(speed) {
    const value = Number(speed);
    if (!Number.isFinite(value)) return 1;
    return Math.min(10, Math.max(0.1, value));
  }

  function loadSpeedPanelPrefs() {
    try {
      const raw = localStorage.getItem(SPEED_PANEL_STORAGE_KEY);
      if (!raw) return { enabled: true, collapsed: false, left: null, top: 50 };
      const parsed = JSON.parse(raw);
      let collapsed = parsed?.collapsed === true;
      if (parsed?.collapsed === undefined && parsed?.visible === false) {
        collapsed = true;
      }
      return {
        enabled: parsed?.enabled !== false,
        collapsed,
        left: Number.isFinite(Number(parsed?.left)) ? Number(parsed.left) : null,
        top: Number.isFinite(Number(parsed?.top)) ? Number(parsed.top) : 50,
      };
    } catch {
      return { enabled: true, collapsed: false, left: null, top: 50 };
    }
  }

  function saveSpeedPanelPrefs(patch) {
    try {
      const current = loadSpeedPanelPrefs();
      localStorage.setItem(
        SPEED_PANEL_STORAGE_KEY,
        JSON.stringify({ ...current, ...patch })
      );
    } catch {}
  }

  function notifyGameSpeedChanged(speed) {
    updateGameSpeedOverlayUI(speed);
    window.postMessage(
      { source: "cocos-hierarchy", type: "game-speed-changed", speed },
      "*"
    );
  }

  function notifyPauseStateChanged(paused) {
    updateGameSpeedOverlayPauseUI(paused);
    window.postMessage(
      { source: "cocos-hierarchy", type: "pause-state-changed", paused },
      "*"
    );
  }

  function ensureGameSpeedOverlayStyles() {
    if (document.getElementById(SPEED_PANEL_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SPEED_PANEL_STYLE_ID;
    style.textContent = `
      #${SPEED_PANEL_ID},
      #${SPEED_PANEL_TAB_ID} {
        font: 11px/1.4 "Lucida Grande", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: #ebebeb;
        z-index: 2147483647;
      }
      #${SPEED_PANEL_ID} {
        position: fixed;
        top: 50px;
        right: 16px;
        width: 245px;
        background: rgba(26, 26, 26, 0.94);
        border: 1px solid #2f2f2f;
        border-radius: 3px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        user-select: none;
      }
      #${SPEED_PANEL_ID}[hidden],
      #${SPEED_PANEL_TAB_ID}[hidden] {
        display: none !important;
      }
      #${SPEED_PANEL_ID} .atsp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        background: #111;
        border-bottom: 1px solid #2f2f2f;
        cursor: move;
      }
      #${SPEED_PANEL_ID} .atsp-title {
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      #${SPEED_PANEL_ID} .atsp-close {
        border: 0;
        background: transparent;
        color: #aaa;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 0 2px;
      }
      #${SPEED_PANEL_ID} .atsp-close:hover {
        color: #fff;
      }
      #${SPEED_PANEL_ID} .atsp-body {
        padding: 8px;
      }
      #${SPEED_PANEL_ID} .atsp-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      #${SPEED_PANEL_ID} .atsp-row label {
        flex: 0 0 72px;
        color: #d8d8d8;
      }
      #${SPEED_PANEL_ID} .atsp-row input[type="range"] {
        flex: 1;
        min-width: 0;
        accent-color: #2fa1d6;
      }
      #${SPEED_PANEL_ID} .atsp-value {
        flex: 0 0 34px;
        text-align: right;
        color: #2fa1d6;
        font-variant-numeric: tabular-nums;
      }
      #${SPEED_PANEL_ID} .atsp-snaps {
        display: flex;
        gap: 4px;
        margin-bottom: 8px;
      }
      #${SPEED_PANEL_ID} .atsp-snaps button,
      #${SPEED_PANEL_ID} .atsp-pause {
        flex: 1;
        border: 1px solid #3a3a3a;
        background: #2a2a2a;
        color: #ebebeb;
        border-radius: 2px;
        padding: 4px 6px;
        cursor: pointer;
      }
      #${SPEED_PANEL_ID} .atsp-snaps button:hover,
      #${SPEED_PANEL_ID} .atsp-pause:hover {
        background: #333;
      }
      #${SPEED_PANEL_ID} .atsp-snaps button.active {
        background: #2fa1d6;
        border-color: #2fa1d6;
        color: #fff;
      }
      #${SPEED_PANEL_ID} .atsp-pause.paused {
        background: #c0392b;
        border-color: #c0392b;
        color: #fff;
      }
      #${SPEED_PANEL_TAB_ID} {
        position: fixed;
        top: 50px;
        right: 16px;
        border: 1px solid #2f2f2f;
        background: rgba(26, 26, 26, 0.94);
        color: #ebebeb;
        border-radius: 16px;
        padding: 6px 12px;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      }
      #${SPEED_PANEL_TAB_ID}:hover {
        background: rgba(40, 40, 40, 0.96);
      }
    `;
    document.documentElement.appendChild(style);
  }

  function updateGameSpeedOverlayUI(speed) {
    if (!speedPanelRefs) return;
    const value = clampGameSpeedValue(speed);
    speedPanelRefs.range.value = String(value);
    speedPanelRefs.value.textContent = `${value.toFixed(1)}x`;
    speedPanelRefs.snaps.forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.speed) === value);
    });
  }

  function updateGameSpeedOverlayPauseUI(paused) {
    if (!speedPanelRefs?.pauseBtn) return;
    speedPanelRefs.pauseBtn.textContent = paused ? "Resume" : "Pause";
    speedPanelRefs.pauseBtn.classList.toggle("paused", paused);
  }

  function applySpeedPanelVisibility() {
    if (!speedPanelRefs) return;
    if (!speedPanelEnabled) {
      speedPanelRefs.panel.hidden = true;
      speedPanelRefs.tab.hidden = true;
      return;
    }
    speedPanelRefs.panel.hidden = speedPanelCollapsed;
    speedPanelRefs.tab.hidden = !speedPanelCollapsed;
  }

  function setGameSpeedOverlayEnabled(enabled) {
    speedPanelEnabled = enabled !== false;
    saveSpeedPanelPrefs({ enabled: speedPanelEnabled });
    ensureGameSpeedOverlayStyles();
    if (!speedPanelRefs) setupGameSpeedOverlay();
    applySpeedPanelVisibility();
    return { ok: true, enabled: speedPanelEnabled };
  }

  function isGameSpeedOverlayEnabled() {
    return speedPanelEnabled;
  }

  function setGameSpeedOverlayCollapsed(collapsed) {
    if (!speedPanelEnabled) {
      return { ok: false, error: "Floating speed panel is disabled in settings" };
    }
    speedPanelCollapsed = !!collapsed;
    saveSpeedPanelPrefs({ collapsed: speedPanelCollapsed });
    applySpeedPanelVisibility();
    return { ok: true, collapsed: speedPanelCollapsed };
  }

  function setGameSpeedOverlayVisible(visible) {
    return setGameSpeedOverlayEnabled(visible);
  }

  function isGameSpeedOverlayVisible() {
    return speedPanelEnabled && !speedPanelCollapsed;
  }

  function setupGameSpeedOverlay() {
    if (speedPanelRefs) return speedPanelRefs;

    ensureGameSpeedOverlayStyles();
    const prefs = loadSpeedPanelPrefs();
    speedPanelEnabled = prefs.enabled;
    speedPanelCollapsed = prefs.collapsed;
    const currentSpeed = getGameSpeed();
    const currentPause = getPauseState();
    const speed = currentSpeed?.ok ? currentSpeed.speed : bridgeGameSpeed;

    const panel = document.createElement("div");
    panel.id = SPEED_PANEL_ID;

    const header = document.createElement("div");
    header.className = "atsp-header";
    const title = document.createElement("span");
    title.className = "atsp-title";
    title.textContent = "AnimTracer";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "atsp-close";
    closeBtn.title = "Hide panel";
    closeBtn.textContent = "×";
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "atsp-body";

    const row = document.createElement("div");
    row.className = "atsp-row";
    const label = document.createElement("label");
    label.textContent = "Game Speed";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0.1";
    range.max = "10";
    range.step = "0.1";
    range.value = String(clampGameSpeedValue(speed));
    const valueEl = document.createElement("span");
    valueEl.className = "atsp-value";
    valueEl.textContent = `${clampGameSpeedValue(speed).toFixed(1)}x`;
    row.appendChild(label);
    row.appendChild(range);
    row.appendChild(valueEl);

    const snaps = document.createElement("div");
    snaps.className = "atsp-snaps";
    const snapButtons = [0.1, 1, 10].map((snapSpeed) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.speed = String(snapSpeed);
      btn.textContent = `${snapSpeed}x`;
      snaps.appendChild(btn);
      return btn;
    });

    const pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "atsp-pause";
    pauseBtn.textContent = "Pause";

    body.appendChild(row);
    body.appendChild(snaps);
    body.appendChild(pauseBtn);
    panel.appendChild(header);
    panel.appendChild(body);

    const tab = document.createElement("button");
    tab.id = SPEED_PANEL_TAB_ID;
    tab.type = "button";
    tab.textContent = "Speed";
    tab.title = "Show AnimTracer speed controls";

    if (prefs.left != null) {
      panel.style.left = `${prefs.left}px`;
      panel.style.top = `${prefs.top}px`;
      panel.style.right = "auto";
    } else {
      panel.style.top = `${prefs.top}px`;
    }

    document.documentElement.appendChild(panel);
    document.documentElement.appendChild(tab);

    speedPanelRefs = { panel, tab, range, value: valueEl, snaps: snapButtons, pauseBtn };

    const applySpeed = (nextSpeed) => {
      const result = setGameSpeed(nextSpeed);
      if (!result?.ok) {
        animTracerLog("Failed to set game speed:", result?.error || "unknown error");
      }
    };

    range.addEventListener("input", () => {
      applySpeed(range.value);
    });
    snapButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        applySpeed(btn.dataset.speed);
      });
    });
    pauseBtn.addEventListener("click", () => {
      const result = togglePauseResume();
      if (!result?.ok) {
        animTracerLog("Failed to toggle pause:", result?.error || "unknown error");
      }
    });
    closeBtn.addEventListener("click", () => {
      setGameSpeedOverlayCollapsed(true);
    });
    tab.addEventListener("click", () => {
      setGameSpeedOverlayCollapsed(false);
    });

    let dragStart = null;
    header.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragStart = {
        x: event.clientX,
        y: event.clientY,
        left: rect.left,
        top: rect.top,
      };
      event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => {
      if (!dragStart) return;
      const left = dragStart.left + event.clientX - dragStart.x;
      const top = dragStart.top + event.clientY - dragStart.y;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
    });
    window.addEventListener("mouseup", () => {
      if (!dragStart) return;
      const rect = panel.getBoundingClientRect();
      saveSpeedPanelPrefs({ left: rect.left, top: rect.top });
      dragStart = null;
    });

    updateGameSpeedOverlayUI(speed);
    updateGameSpeedOverlayPauseUI(!!currentPause?.paused);
    applySpeedPanelVisibility();
    return speedPanelRefs;
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

  function animTracerLog(...args) {
    console.log(
      "%c AnimTracer ",
      "color: white; background: rgba(100,100,255,125); padding: 2px 4px;",
      ...args
    );
  }

  /**
   * Watch an object property and log every set (console helper).
   * Usage: animTracer.watchProperty($c, "someProp")
   *        animTracer.watchProperty(obj, "x", (v) => console.log(v))
   */
  function watchProperty(obj, prop, onSet) {
    if (obj == null || prop == null || prop === "") {
      return { ok: false, error: "obj and prop are required" };
    }
    let value = obj[prop];
    Object.defineProperty(obj, prop, {
      get() {
        return value;
      },
      set(newVal) {
        animTracerLog(obj, `Property "${prop}" changed:`, value, "→", newVal);
        if (typeof onSet === "function") onSet(newVal);
        value = newVal;
      },
      configurable: true,
    });
    animTracerLog(`Watching "${prop}" on`, obj);
    return { ok: true, prop: String(prop) };
  }

  /**
   * Watch an object property for a single change, then restore a plain value.
   * Usage: animTracer.watchPropertyOneShot($n, "active")
   */
  function watchPropertyOneShot(obj, prop, onSet) {
    if (obj == null || prop == null || prop === "") {
      return { ok: false, error: "obj and prop are required" };
    }
    let value = obj[prop];
    Object.defineProperty(obj, prop, {
      get() {
        return value;
      },
      set(newVal) {
        animTracerLog(`Property "${prop}" changed:`, value, "→", newVal);
        Object.defineProperty(obj, prop, {
          value: newVal,
          writable: true,
          configurable: true,
        });
        if (typeof onSet === "function") onSet(newVal);
        value = newVal;
      },
      configurable: true,
    });
    animTracerLog(`One-shot watching "${prop}" on`, obj);
    return { ok: true, prop: String(prop) };
  }

  function init() {
    const cc = getCocos();
    if (!cc) return false;

    hookDirector(cc);
    setupPauseKeyboardShortcut();
    setupGameSpeedOverlay();

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
    getComponentProperties,
    setComponentProperty,
    getNodeProperties,
    setNodeProperty,
    toggleActive,
    setActive,
    findNodeReferences,
    traceSpineAnimation,
    clearSpineAnimationTrace,
    getSpineAnimationNames,
    getSkeletonBoneTree,
    highlightSkeletonBone,
    clearSkeletonBoneHighlight,
    setGameSpeed,
    getGameSpeed,
    setGameSpeedOverlayEnabled,
    isGameSpeedOverlayEnabled,
    setGameSpeedOverlayVisible,
    isGameSpeedOverlayVisible,
    togglePauseResume,
    getPauseState,
    registerNodeEventBreak,
    clearNodeEventBreaks,
    getNodeEventBreaks,
    getNodeEventBreakTypes,
    highlightNode,
    clearNodeHighlight,
    init,
    isReady: () => !!getCocos(),
  };

  // Console helpers: animTracer.watchProperty / animTracer.watchPropertyOneShot
  window.animTracer = Object.assign(window.animTracer || {}, {
    watchProperty,
    watchPropertyOneShot,
  });

  if (!init()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (init() || attempts >= 120) clearInterval(timer);
    }, 500);
  }
})();
