const treeEl = document.getElementById("tree");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const componentFilterEl = document.getElementById("component-filter");
const clearFiltersBtn = document.getElementById("btn-clear-filters");
const expandAllBtn = document.getElementById("btn-expand-all");
const collapseAllBtn = document.getElementById("btn-collapse-all");
const layoutEl = document.querySelector(".layout");
const toolsResizerEl = document.getElementById("tools-resizer");
const refUuidInputEl = document.getElementById("ref-uuid-input");
const findRefsBtn = document.getElementById("btn-find-refs");
const spineTraceToolEl = document.getElementById("spine-trace-tool");
const spineAnimationInputEl = document.getElementById("spine-animation-input");
const spineAnimationSuggestionsEl = document.getElementById("spine-animation-suggestions");
const spineAnimationSuggestionListEl = document.getElementById("spine-animation-suggestion-list");
const traceSpineBtn = document.getElementById("btn-trace-spine");
const clearSpineTraceBtn = document.getElementById("btn-clear-spine-trace");
const referenceResultsEl = document.getElementById("reference-results");
const toolStatusEl = document.getElementById("tool-status");
const buildNoteEl = document.getElementById("build-note");
const gameSpeedRangeEl = document.getElementById("game-speed-range");
const gameSpeedInputEl = document.getElementById("game-speed-input");
const pauseResumeBtnEl = document.getElementById("btn-pause-resume");
const themeToggleBtnEl = document.getElementById("btn-theme-toggle");
const toolsToggleBtnEl = document.getElementById("btn-toggle-tools");
const toolsPanelEl = document.getElementById("tools-panel");
const autoRefreshEl = document.getElementById("auto-refresh");
const refreshBtn = document.getElementById("btn-refresh");

let hierarchy = null;
let selectedUuid = null;
let expanded = new Set();
let collapsed = new Set();
let expansionMode = "default";
let lastFilterKey = "";
let nameFilter = "";
let componentFilter = "";
let refreshTimer = null;
let port = null;
let referenceResults = [];
let highlightedReferenceNodeUuid = null;
let spineAnimationNames = [];
let hoverHighlightTimer = null;
let clearHighlightTimer = null;
let hoverHighlightUuid = null;
let selectedComponentIndex = null;
let componentProperties = [];
let componentPropertiesName = "";
let nodeProperties = [];
let nodePropertiesStatus = "idle"; // idle | loading | ready | error
let nodePropertiesError = "";
const TOOLS_MIN_WIDTH = 260;
const TOOLS_MAX_WIDTH = 700;
const THEME_STORAGE_KEY = "animtracer-theme-preference";
const TOOLS_PANEL_STORAGE_KEY = "animtracer-tools-panel-open";

let themePreference = "auto";

function devToolsThemeToPanel(theme) {
  return theme === "dark" ? "dark" : "light";
}

function getDevToolsTheme() {
  try {
    return devToolsThemeToPanel(chrome.devtools.panels.themeName);
  } catch {
    return "dark";
  }
}

function getEffectiveTheme() {
  if (themePreference === "light" || themePreference === "dark") {
    return themePreference;
  }
  return getDevToolsTheme();
}

function updateThemeToggleUI(theme) {
  themeToggleBtnEl.classList.toggle("theme-auto", themePreference === "auto");
  const modeLabel = themePreference === "auto" ? "matching DevTools" : "manual";
  themeToggleBtnEl.title = `Theme: ${theme === "dark" ? "Dark" : "Light"} (${modeLabel}). Click to toggle. Shift+click to match DevTools.`;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  updateThemeToggleUI(theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "auto") {
    themePreference = saved;
  }
  applyTheme(getEffectiveTheme());

  if (chrome.devtools?.panels?.setThemeChangeHandler) {
    chrome.devtools.panels.setThemeChangeHandler((theme) => {
      if (themePreference === "auto") {
        applyTheme(devToolsThemeToPanel(theme));
      }
    });
  }
}

function toggleThemePreference(shiftKey) {
  if (shiftKey) {
    themePreference = "auto";
  } else if (themePreference === "auto") {
    themePreference = getEffectiveTheme() === "dark" ? "light" : "dark";
  } else {
    themePreference = themePreference === "dark" ? "light" : "dark";
  }
  localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  applyTheme(getEffectiveTheme());
}

const EVAL_GET_HIERARCHY = `(() => {
  if (!window.__cocosHierarchyBridge__) return { ok: false, error: "Bridge not injected" };
  return window.__cocosHierarchyBridge__.getHierarchy();
})()`;

const EVAL_SELECT = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.selectNode(${JSON.stringify(uuid)}) ?? false;
})()`;

const EVAL_SELECT_COMPONENT = (uuid, componentIndex) => `(() => {
  return window.__cocosHierarchyBridge__?.selectComponent(
    ${JSON.stringify(uuid)},
    ${JSON.stringify(componentIndex)}
  ) ?? false;
})()`;

const EVAL_GET_COMPONENT_PROPS = (uuid, componentIndex) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.getComponentProperties !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page", properties: [] };
  }
  return bridge.getComponentProperties(
    ${JSON.stringify(uuid)},
    ${JSON.stringify(componentIndex)}
  );
})()`;

const EVAL_SET_COMPONENT_PROP = (uuid, componentIndex, key, value) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.setComponentProperty !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.setComponentProperty(
    ${JSON.stringify(uuid)},
    ${JSON.stringify(componentIndex)},
    ${JSON.stringify(key)},
    ${JSON.stringify(value)}
  );
})()`;

const EVAL_GET_NODE_PROPS = (uuid) => `(() => {
  const targetUuid = ${JSON.stringify(uuid)};
  const bridge = window.__cocosHierarchyBridge__;
  if (bridge && typeof bridge.getNodeProperties === "function") {
    try {
      return bridge.getNodeProperties(targetUuid);
    } catch (err) {
      return { ok: false, error: err?.message || String(err), properties: [] };
    }
  }

  const cc = window.cc?.director ? window.cc : (window.cocos?.director ? window.cocos : null);
  const scene = cc?.director?.getScene?.();
  if (!scene) return { ok: false, error: "No active scene", properties: [] };

  function findNodeByUuid(root, id) {
    if (!root) return null;
    if (root.uuid === id) return root;
    for (const child of root.children || []) {
      const found = findNodeByUuid(child, id);
      if (found) return found;
    }
    return null;
  }

  function asVec3(value, fallback) {
    const base = fallback || { x: 0, y: 0, z: 0 };
    if (!value || typeof value !== "object") return { ...base };
    return {
      x: Number.isFinite(Number(value.x)) ? Number(value.x) : base.x,
      y: Number.isFinite(Number(value.y)) ? Number(value.y) : base.y,
      z: Number.isFinite(Number(value.z)) ? Number(value.z) : base.z,
    };
  }

  const resolved =
    findNodeByUuid(scene, String(targetUuid || "").trim()) ||
    (window.$n && window.$n.uuid === targetUuid ? window.$n : null);
  if (!resolved) return { ok: false, error: "Node not found", properties: [] };

  const properties = [];
  try {
    properties.push({ key: "name", rawKey: "name", type: "string", fields: null, value: String(resolved.name ?? "") });
  } catch {}
  try {
    properties.push({ key: "active", rawKey: "active", type: "boolean", fields: null, value: !!resolved.active });
  } catch {}
  try {
    let pos = resolved.position;
    if (!pos && typeof resolved.getPosition === "function") pos = resolved.getPosition();
    if (!pos) pos = { x: resolved.x ?? 0, y: resolved.y ?? 0, z: resolved.z ?? 0 };
    properties.push({ key: "position", rawKey: "position", type: "vec3", fields: ["x", "y", "z"], value: asVec3(pos) });
  } catch {
    properties.push({ key: "position", rawKey: "position", type: "vec3", fields: ["x", "y", "z"], value: { x: 0, y: 0, z: 0 } });
  }
  try {
    let scale = resolved.scale;
    if (!scale && typeof resolved.getScale === "function") scale = resolved.getScale();
    properties.push({
      key: "scale",
      rawKey: "scale",
      type: "vec3",
      fields: ["x", "y", "z"],
      value: asVec3(scale, { x: 1, y: 1, z: 1 }),
    });
  } catch {
    properties.push({ key: "scale", rawKey: "scale", type: "vec3", fields: ["x", "y", "z"], value: { x: 1, y: 1, z: 1 } });
  }
  try {
    if (resolved.eulerAngles) {
      properties.push({
        key: "eulerAngles",
        rawKey: "eulerAngles",
        type: "vec3",
        fields: ["x", "y", "z"],
        value: asVec3(resolved.eulerAngles),
      });
    }
  } catch {}
  try {
    if (typeof resolved.angle === "number") {
      properties.push({ key: "angle", rawKey: "angle", type: "number", fields: null, value: resolved.angle });
    }
  } catch {}
  try {
    if (typeof resolved.layer === "number") {
      properties.push({ key: "layer", rawKey: "layer", type: "number", fields: null, value: resolved.layer });
    }
  } catch {}

  return { ok: true, properties };
})()`;

const EVAL_SET_NODE_PROP = (uuid, key, value) => `(() => {
  const targetUuid = ${JSON.stringify(uuid)};
  const propKey = ${JSON.stringify(key)};
  const nextValue = ${JSON.stringify(value)};
  const bridge = window.__cocosHierarchyBridge__;
  if (bridge && typeof bridge.setNodeProperty === "function") {
    try {
      return bridge.setNodeProperty(targetUuid, propKey, nextValue);
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  const cc = window.cc?.director ? window.cc : (window.cocos?.director ? window.cocos : null);
  const scene = cc?.director?.getScene?.();
  function findNodeByUuid(root, id) {
    if (!root) return null;
    if (root.uuid === id) return root;
    for (const child of root.children || []) {
      const found = findNodeByUuid(child, id);
      if (found) return found;
    }
    return null;
  }
  const node =
    (scene && findNodeByUuid(scene, String(targetUuid || "").trim())) ||
    (window.$n && window.$n.uuid === targetUuid ? window.$n : null);
  if (!node) return { ok: false, error: "Node not found" };

  try {
    if (propKey === "name") {
      node.name = String(nextValue ?? "");
      return { ok: true, key: propKey, type: "string", value: node.name };
    }
    if (propKey === "active") {
      node.active = nextValue === true || nextValue === "true" || nextValue === 1 || nextValue === "1";
      return { ok: true, key: propKey, type: "boolean", value: !!node.active };
    }
    if (propKey === "layer" || propKey === "angle") {
      const n = Number(nextValue);
      if (!Number.isFinite(n)) return { ok: false, error: "Invalid number" };
      node[propKey] = n;
      return { ok: true, key: propKey, type: "number", value: node[propKey] };
    }
    if (propKey === "position" || propKey === "scale" || propKey === "eulerAngles") {
      const x = Number(nextValue?.x) || 0;
      const y = Number(nextValue?.y) || 0;
      const z = Number(nextValue?.z) || 0;
      if (propKey === "position") {
        if (typeof node.setPosition === "function") node.setPosition(x, y, z);
        else if (node.position) { node.position.x = x; node.position.y = y; node.position.z = z; }
        else { node.x = x; node.y = y; node.z = z; }
      } else if (propKey === "scale") {
        if (typeof node.setScale === "function") node.setScale(x, y, z);
        else if (node.scale) { node.scale.x = x; node.scale.y = y; node.scale.z = z; }
      } else if (propKey === "eulerAngles") {
        if (typeof node.setRotationFromEuler === "function") node.setRotationFromEuler(x, y, z);
        else if (node.eulerAngles) { node.eulerAngles.x = x; node.eulerAngles.y = y; node.eulerAngles.z = z; }
      }
      return { ok: true, key: propKey, type: "vec3", fields: ["x", "y", "z"], value: { x, y, z } };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  return { ok: false, error: "Unsupported node property: " + propKey };
})()`;

const EVAL_TOGGLE = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.toggleActive(${JSON.stringify(uuid)}) ?? false;
})()`;

const EVAL_FIND_REFS = (uuid) => `(() => {
  const targetUuid = ${JSON.stringify(uuid)};
  const cc = window.cc?.director ? window.cc : (window.cocos?.director ? window.cocos : null);
  const scene = cc?.director?.getScene?.();
  if (!scene) return { ok: false, error: "No active scene" };

  function getNodePath(node) {
    const parts = [];
    let curr = node;
    while (curr) {
      parts.push(curr.name || "(unnamed)");
      curr = curr.parent || null;
    }
    return parts.reverse().join("/");
  }

  function findNodeByUuid(root, id) {
    if (!root) return null;
    if (root.uuid === id) return root;
    const children = root.children || [];
    for (const child of children) {
      const found = findNodeByUuid(child, id);
      if (found) return found;
    }
    return null;
  }

  function isSkippedRefKey(key, depth) {
    if (!key || key.startsWith("__")) return true;
    if (
      key === "constructor" || key === "prototype" ||
      key === "_id" || key === "_objFlags" || key === "_name" || key === "_enabled" ||
      key === "_parent" || key === "_children" || key === "_components" ||
      key === "_scene" || key === "_eventProcessor" || key === "_persistNode" ||
      key === "pos" || key === "rot" || key === "scale"
    ) return true;
    if (depth === 0 && (key === "node" || key === "_node")) return true;
    return false;
  }

  function collectOwnKeys(value) {
    const keys = new Set();
    try { Object.keys(value).forEach((k) => keys.add(k)); } catch {}
    try { Object.getOwnPropertyNames(value).forEach((k) => keys.add(k)); } catch {}
    try {
      const declared = value.constructor?.__values__ || value.constructor?.__props__;
      if (Array.isArray(declared)) declared.forEach((k) => keys.add(k));
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
      const privateKey = key[0] === "_" ? null : ("_" + key);
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
    if (/^(Vec2|Vec3|Vec4|Color|Quat|Mat3|Mat4|Size|Rect|Node|Scene|Component|Asset|Texture2D|TextureBase|TextureCube|Material|Mesh|MeshBuffer|Pass|Device|Camera|RenderTexture|SpriteFrame|BitmapFont|Font|EffectAsset|Graphics|UITransform|UIOpacity|Widget|Label|Sprite|RichText|Layout|Mask|Canvas|Model|SubModel|Renderer|Renderable2D|Batcher2D|NodeEventProcessor|SystemEvent)$/.test(name)) {
      return true;
    }
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
      const isIndex = Array.isArray(value) && /^\\d+$/.test(key);
      const fieldPath = path
        ? (isIndex ? path + "[" + key + "]" : path + "." + key)
        : String(key).replace(/^_/, "");
      if (isNodeLike(child, target)) {
        hits.push(fieldPath);
        continue;
      }
      if (shouldNotDescend(child)) continue;
      hits.push(...scanObjectForNodeRef(child, target, visited, depth + 1, fieldPath));
    }
    return hits;
  }

  const target = findNodeByUuid(scene, String(targetUuid || "").trim());
  if (!target) return { ok: false, error: "Node not found for UUID: " + targetUuid };

  const hits = [];
  const stack = [scene];
  while (stack.length) {
    const node = stack.pop();
    const comps = node?._components || [];
    for (const comp of comps) {
      if (!comp) continue;
      const fieldNames = scanObjectForNodeRef(comp, target, new WeakSet(), 0, "");
      if (!fieldNames.length) continue;
      let compName = comp.constructor?.name || "Component";
      try {
        if (cc?.js?.getClassName) compName = cc.js.getClassName(comp) || compName;
      } catch {}
      for (const fieldName of fieldNames) {
        hits.push({
          nodeUuid: node.uuid,
          nodeName: node.name || "(unnamed)",
          hierarchyPath: getNodePath(node),
          componentName: compName || "Component",
          fieldName: fieldName || "(unknown field)",
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
})()`;

const EVAL_TRACE_SPINE = (uuid, animationName) => `(() => {
  return window.__cocosHierarchyBridge__?.traceSpineAnimation(
    ${JSON.stringify(uuid)},
    ${JSON.stringify(animationName)}
  ) ?? { ok: false, error: "Bridge not injected" };
})()`;

const EVAL_CLEAR_SPINE_TRACE = (uuid) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.clearSpineAnimationTrace !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.clearSpineAnimationTrace(${JSON.stringify(uuid)});
})()`;

const EVAL_SPINE_ANIMATION_NAMES = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.getSpineAnimationNames(${JSON.stringify(uuid)}) ?? { ok: false, error: "Bridge not injected", names: [] };
})()`;

const EVAL_SET_GAME_SPEED = (speed) => `(() => {
  return window.__cocosHierarchyBridge__?.setGameSpeed(${speed}) ?? { ok: false, error: "Bridge not injected" };
})()`;

const EVAL_GET_GAME_SPEED = `(() => {
  return window.__cocosHierarchyBridge__?.getGameSpeed() ?? { ok: false, speed: 1 };
})()`;

const EVAL_TOGGLE_PAUSE = `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.togglePauseResume !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.togglePauseResume();
})()`;

const EVAL_GET_PAUSE_STATE = `(() => {
  return window.__cocosHierarchyBridge__?.getPauseState() ?? { ok: false, paused: false };
})()`;

const EVAL_HIGHLIGHT_NODE = (uuid) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.highlightNode !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.highlightNode(${JSON.stringify(uuid)});
})()`;

const EVAL_CLEAR_HIGHLIGHT = `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.clearNodeHighlight !== "function") {
    return { ok: false };
  }
  return bridge.clearNodeHighlight();
})()`;

function evalInPage(expression, callback) {
  chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
    if (exceptionInfo?.isException) {
      const value = exceptionInfo.value;
      const message =
        value?.description ||
        value?.value ||
        (typeof value === "string" ? value : null) ||
        "Eval error";
      callback(null, message);
      return;
    }
    callback(result, null);
  });
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function setToolStatus(text, type = "") {
  toolStatusEl.textContent = text;
  toolStatusEl.className = `tool-status ${type}`;
}

function setBuildNote() {
  const info = window.__ANIMTRACER_BUILD_INFO__ || {};
  const version = info.version || chrome.runtime?.getManifest?.().version || "dev";
  const updateNote = info.updateNote || "local";
  buildNoteEl.textContent = `v${version} • ${updateNote}`;
}

function clampGameSpeed(speed) {
  const value = Number(speed);
  if (!Number.isFinite(value)) return 1;
  return Math.min(10, Math.max(0.1, value));
}

function updateGameSpeedUI(speed) {
  const value = clampGameSpeed(speed);
  gameSpeedRangeEl.value = String(value);
  gameSpeedInputEl.value = String(value);
  document.querySelectorAll(".speed-snap").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.speed) === value);
  });
}

function applyGameSpeed(speed) {
  const value = clampGameSpeed(speed);
  updateGameSpeedUI(value);
  evalInPage(EVAL_SET_GAME_SPEED(value), (result, err) => {
    if (err || !result?.ok) {
      setToolStatus(result?.error || err || "Failed to set game speed.", "error");
      return;
    }
    setToolStatus(`Game speed set to ${result.speed}x`, "ok");
  });
}

function syncGameSpeedFromPage() {
  evalInPage(EVAL_GET_GAME_SPEED, (result) => {
    if (result?.ok) updateGameSpeedUI(result.speed);
  });
}

function updatePauseResumeUI(paused) {
  pauseResumeBtnEl.textContent = paused ? "Resume" : "Pause";
  pauseResumeBtnEl.classList.toggle("paused", paused);
}

function togglePauseResume() {
  evalInPage(EVAL_TOGGLE_PAUSE, (result, err) => {
    if (err || !result?.ok) {
      setToolStatus(result?.error || err || "Failed to toggle pause.", "error");
      return;
    }
    updatePauseResumeUI(result.paused);
    setToolStatus(result.paused ? "Game paused" : "Game resumed", "ok");
  });
}

function syncPauseStateFromPage() {
  evalInPage(EVAL_GET_PAUSE_STATE, (result) => {
    if (result?.ok) updatePauseResumeUI(result.paused);
  });
}

function setToolsPanelOpen(open) {
  toolsPanelEl.hidden = !open;
  toolsToggleBtnEl.classList.toggle("active", open);
  toolsToggleBtnEl.setAttribute("aria-expanded", open ? "true" : "false");
  toolsToggleBtnEl.title = open ? "Hide tools" : "Show tools";
  toolsToggleBtnEl.textContent = open ? "Tools ▴" : "Tools ▾";
  try {
    localStorage.setItem(TOOLS_PANEL_STORAGE_KEY, open ? "1" : "0");
  } catch {}
}

function initToolsPanelToggle() {
  let open = false;
  try {
    open = localStorage.getItem(TOOLS_PANEL_STORAGE_KEY) === "1";
  } catch {}
  setToolsPanelOpen(open);
  toolsToggleBtnEl.addEventListener("click", () => {
    setToolsPanelOpen(toolsPanelEl.hidden);
  });
}

function initToolsPanelResizer() {
  let isDragging = false;

  const onPointerMove = (event) => {
    if (!isDragging) return;
    const rect = layoutEl.getBoundingClientRect();
    const rightSideWidth = rect.right - event.clientX;
    const maxAllowed = Math.max(TOOLS_MIN_WIDTH, rect.width - 220);
    const width = Math.min(Math.max(rightSideWidth, TOOLS_MIN_WIDTH), Math.min(TOOLS_MAX_WIDTH, maxAllowed));
    document.documentElement.style.setProperty("--tools-width", `${Math.round(width)}px`);
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  toolsResizerEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    isDragging = true;
    document.body.classList.add("resizing");
    toolsResizerEl.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

function highlightNodeInGame(uuid) {
  const id = String(uuid || "").trim();
  if (!id) return;
  if (clearHighlightTimer) {
    clearTimeout(clearHighlightTimer);
    clearHighlightTimer = null;
  }
  if (hoverHighlightUuid === id) return;
  hoverHighlightUuid = id;
  evalInPage(EVAL_HIGHLIGHT_NODE(id), () => {});
}

function clearNodeHighlightInGame() {
  if (hoverHighlightTimer) {
    clearTimeout(hoverHighlightTimer);
    hoverHighlightTimer = null;
  }
  if (clearHighlightTimer) clearTimeout(clearHighlightTimer);
  clearHighlightTimer = setTimeout(() => {
    clearHighlightTimer = null;
    hoverHighlightUuid = null;
    evalInPage(EVAL_CLEAR_HIGHLIGHT, () => {});
  }, 40);
}

function scheduleNodeHighlight(uuid) {
  if (clearHighlightTimer) {
    clearTimeout(clearHighlightTimer);
    clearHighlightTimer = null;
  }
  if (hoverHighlightTimer) clearTimeout(hoverHighlightTimer);
  hoverHighlightTimer = setTimeout(() => {
    hoverHighlightTimer = null;
    highlightNodeInGame(uuid);
  }, 20);
}

function setReferenceResults(items) {
  referenceResults = Array.isArray(items) ? items : [];
  if (!referenceResults.length) {
    referenceResultsEl.className = "reference-results empty";
    referenceResultsEl.textContent = "No references found.";
    return;
  }

  referenceResultsEl.className = "reference-results";
  referenceResultsEl.innerHTML = "";
  referenceResults.forEach((hit) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reference-item";
    if (highlightedReferenceNodeUuid === hit.nodeUuid) btn.classList.add("active");
    const fieldLabel = hit.fieldName ? ` • ${escapeHtml(hit.fieldName)}` : " • (unknown field)";
    btn.innerHTML = `
      <span class="reference-item-title">${escapeHtml(hit.hierarchyPath || hit.nodeName || hit.nodeUuid)}</span>
      <span class="reference-item-meta">${escapeHtml(hit.componentName || "Component")}${fieldLabel} • ${escapeHtml(hit.nodeUuid || "")}</span>
    `;
    btn.addEventListener("click", () => focusReferenceHolder(hit.nodeUuid));
    referenceResultsEl.appendChild(btn);
  });
}

function hasActiveFilters() {
  return !!(nameFilter || componentFilter);
}

function nodeMatchesSelf(node) {
  if (nameFilter && !node.name.toLowerCase().includes(nameFilter.toLowerCase())) {
    return false;
  }
  if (componentFilter) {
    const hasComponent = node.components.some(
      (c) => c.toLowerCase() === componentFilter.toLowerCase()
    );
    if (!hasComponent) return false;
  }
  return true;
}

function nodeMatchesTree(node) {
  if (!hasActiveFilters()) return true;
  if (nodeMatchesSelf(node)) return true;
  return node.children.some((child) => nodeMatchesTree(child));
}

function getMatchingComponents(node) {
  if (!componentFilter) return [];
  return node.components.filter(
    (c) => c.toLowerCase() === componentFilter.toLowerCase()
  );
}

function nodeHasSkeletonComponent(node) {
  if (!node?.components) return false;
  return node.components.some((name) => /spine|skeleton/i.test(String(name)));
}

function updateSpineTraceToolVisibility(node) {
  const visible = nodeHasSkeletonComponent(node);
  spineTraceToolEl.hidden = !visible;
  if (!visible) {
    spineAnimationInputEl.value = "";
    spineAnimationSuggestionsEl.innerHTML = "";
    spineAnimationSuggestionListEl.hidden = true;
    spineAnimationSuggestionListEl.innerHTML = "";
    spineAnimationNames = [];
  }
}

function renderSpineAnimationSuggestions(filterText = "") {
  const q = String(filterText || "").toLowerCase().trim();
  const names = q
    ? spineAnimationNames.filter((name) => name.toLowerCase().includes(q))
    : spineAnimationNames;
  if (!names.length) {
    spineAnimationSuggestionListEl.hidden = true;
    spineAnimationSuggestionListEl.innerHTML = "";
    return;
  }
  spineAnimationSuggestionListEl.hidden = false;
  spineAnimationSuggestionListEl.innerHTML = "";
  names.slice(0, 60).forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-item";
    btn.textContent = name;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      spineAnimationInputEl.value = name;
      spineAnimationSuggestionListEl.hidden = true;
    });
    spineAnimationSuggestionListEl.appendChild(btn);
  });
}

function loadSpineAnimationSuggestions() {
  const uuid = (refUuidInputEl.value || selectedUuid || "").trim();
  if (!uuid || spineTraceToolEl.hidden) return;
  evalInPage(EVAL_SPINE_ANIMATION_NAMES(uuid), (result, err) => {
    if (err || !result?.ok) {
      spineAnimationSuggestionsEl.innerHTML = "";
      spineAnimationSuggestionListEl.hidden = true;
      spineAnimationNames = [];
      return;
    }
    const names = Array.isArray(result.names) ? result.names : [];
    spineAnimationNames = names;
    spineAnimationSuggestionsEl.innerHTML = "";
    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      spineAnimationSuggestionsEl.appendChild(option);
    });
    renderSpineAnimationSuggestions(spineAnimationInputEl.value);
  });
}

function collectComponentCounts(node, counts = new Map()) {
  for (const comp of node.components) {
    counts.set(comp, (counts.get(comp) || 0) + 1);
  }
  for (const child of node.children) {
    collectComponentCounts(child, counts);
  }
  return counts;
}

function updateComponentFilterOptions() {
  if (!hierarchy?.ok || !hierarchy.tree) return;

  const counts = collectComponentCounts(hierarchy.tree);
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const current = componentFilter;
  componentFilterEl.innerHTML = '<option value="">All components</option>';
  for (const [name, count] of sorted) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} (${count})`;
    componentFilterEl.appendChild(option);
  }

  if (current && counts.has(current)) {
    componentFilterEl.value = current;
  } else if (current) {
    componentFilter = "";
    componentFilterEl.value = "";
  }
}

function getFilterKey() {
  return `${nameFilter}\0${componentFilter}`;
}

function resetExpansionForFilters() {
  lastFilterKey = getFilterKey();
  expansionMode = "default";
  expanded.clear();
  collapsed.clear();
}

function applyFilterExpansion() {
  if (!hasActiveFilters() || !hierarchy?.tree) return;
  ensureExpandedForFilter(hierarchy.tree);
}

function isNodeExpanded(node, depth) {
  const hasChildren = node.children.length > 0;
  if (!hasChildren) return false;
  if (expansionMode === "all") return true;
  if (expansionMode === "none") return false;
  if (collapsed.has(node.uuid)) return false;
  if (expanded.has(node.uuid)) return true;
  return !hasActiveFilters() && depth < 2;
}

function expandAll() {
  expansionMode = "all";
  expanded.clear();
  collapsed.clear();
  renderTree();
}

function collapseAll() {
  expansionMode = "none";
  expanded.clear();
  collapsed.clear();
  renderTree();
}

function toggleNodeExpansion(node, isExpanded) {
  if (!node.children.length) return;
  expansionMode = "default";
  if (isExpanded) {
    collapsed.add(node.uuid);
    expanded.delete(node.uuid);
  } else {
    collapsed.delete(node.uuid);
    expanded.add(node.uuid);
  }
  renderTree();
}

function ensureExpandedForFilter(node) {
  if (!hasActiveFilters()) return;
  for (const child of node.children) {
    if (nodeMatchesTree(child)) expanded.add(node.uuid);
    ensureExpandedForFilter(child);
  }
}

function expandPathToNode(root, targetUuid) {
  if (!root) return false;
  if (root.uuid === targetUuid) return true;
  for (const child of root.children || []) {
    if (expandPathToNode(child, targetUuid)) {
      expanded.add(root.uuid);
      collapsed.delete(root.uuid);
      return true;
    }
  }
  return false;
}

function focusReferenceHolder(nodeUuid) {
  if (!hierarchy?.tree || !nodeUuid) return;
  expansionMode = "default";
  expandPathToNode(hierarchy.tree, nodeUuid);
  highlightedReferenceNodeUuid = nodeUuid;
  const node = findNode(hierarchy.tree, nodeUuid);
  if (node) {
    if (selectedUuid !== nodeUuid) {
      selectedComponentIndex = null;
      componentProperties = [];
      componentPropertiesName = "";
      nodeProperties = [];
      nodePropertiesStatus = "idle";
      nodePropertiesError = "";
    }
    selectedUuid = nodeUuid;
    refUuidInputEl.value = nodeUuid;
    updateSpineTraceToolVisibility(node);
    evalInPage(EVAL_SELECT(nodeUuid), () => {});
    nodePropertiesStatus = "loading";
    renderDetail(node);
    loadNodeProperties(nodeUuid);
  }
  renderTree();
  setReferenceResults(referenceResults);
}

function updateClearFiltersButton() {
  clearFiltersBtn.hidden = !hasActiveFilters();
}

function renderTree() {
  treeEl.innerHTML = "";

  if (!hierarchy?.ok) {
    treeEl.innerHTML = `<div class="no-match">${hierarchy?.error || "No hierarchy data"}</div>`;
    return;
  }

  const filterKey = getFilterKey();
  if (filterKey !== lastFilterKey) {
    resetExpansionForFilters();
    applyFilterExpansion();
  }

  const visible = nodeMatchesTree(hierarchy.tree);
  if (!visible) {
    const parts = [];
    if (nameFilter) parts.push(`name "${nameFilter}"`);
    if (componentFilter) parts.push(`component "${componentFilter}"`);
    treeEl.innerHTML = `<div class="no-match">No nodes match ${parts.join(" and ")}</div>`;
    return;
  }

  renderNode(hierarchy.tree, 0, treeEl);
  requestAnimationFrame(() => {
    if (!highlightedReferenceNodeUuid) return;
    const row = treeEl.querySelector(`.tree-row[data-uuid="${CSS.escape(highlightedReferenceNodeUuid)}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
    }
  });
}

function renderNode(node, depth, container) {
  if (hasActiveFilters() && !nodeMatchesTree(node)) return;

  const hasChildren = node.children.length > 0;
  const isExpanded = isNodeExpanded(node, depth);
  const isSelected = selectedUuid === node.uuid;
  const isDirectMatch = hasActiveFilters() && nodeMatchesSelf(node);
  const matchedComponents = getMatchingComponents(node);

  const nodeEl = document.createElement("div");
  nodeEl.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset.uuid = node.uuid;
  if (!node.activeInHierarchy) row.classList.add("inactive");
  if (node.isSpine) row.classList.add("spine");
  if (isSelected) row.classList.add("selected");
  if (isDirectMatch) row.classList.add("filter-match");
  if (highlightedReferenceNodeUuid === node.uuid) row.classList.add("reference-highlight");
  row.style.paddingLeft = `${depth * 12 + 4}px`;

  const toggle = document.createElement("span");
  toggle.className = `toggle ${hasChildren ? "clickable" : "empty"}`;
  toggle.textContent = hasChildren ? (isExpanded ? "▼" : "▶") : "";
  toggle.title = hasChildren ? "Expand/collapse" : "";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNodeExpansion(node, isExpanded);
  });

  const icon = document.createElement("span");
  icon.className = `node-icon${hasChildren ? " clickable" : ""}`;
  icon.textContent = hasChildren ? "📁" : "📄";
  icon.title = hasChildren ? "Expand/collapse" : "";
  if (hasChildren) {
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNodeExpansion(node, isExpanded);
    });
  }

  const name = document.createElement("span");
  name.className = `node-name${hasChildren ? " expandable" : ""}`;
  name.textContent = node.name;
  if (hasChildren) {
    name.title = "Double-click to expand/collapse";
    name.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleNodeExpansion(node, isExpanded);
    });
  }

  row.appendChild(toggle);
  row.appendChild(icon);
  row.appendChild(name);

  if (matchedComponents.length) {
    for (const comp of matchedComponents) {
      const compBadge = document.createElement("span");
      compBadge.className = "node-badge component-match";
      compBadge.textContent = comp;
      row.appendChild(compBadge);
    }
  } else if (node.isSpine || (node.childCount && !hasActiveFilters())) {
    const badge = document.createElement("span");
    badge.className = `node-badge${node.isSpine ? " spine" : ""}`;
    badge.textContent = node.isSpine ? "spine" : node.childCount || "";
    row.appendChild(badge);
  }

  row.addEventListener("click", () => selectNode(node));
  row.addEventListener("mouseenter", () => scheduleNodeHighlight(node.uuid));
  row.addEventListener("mouseleave", () => clearNodeHighlightInGame());

  nodeEl.appendChild(row);

  if (hasChildren && isExpanded) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "tree-children";
    for (const child of node.children) {
      renderNode(child, depth + 1, childrenEl);
    }
    nodeEl.appendChild(childrenEl);
  }

  container.appendChild(nodeEl);
}

function findNode(node, uuid) {
  if (node.uuid === uuid) return node;
  for (const child of node.children) {
    const found = findNode(child, uuid);
    if (found) return found;
  }
  return null;
}

function selectNode(node) {
  const previousSelectedUuid = selectedUuid;
  selectedUuid = node.uuid;
  refUuidInputEl.value = node.uuid;
  if (previousSelectedUuid !== node.uuid) {
    highlightedReferenceNodeUuid = null;
    referenceResultsEl.className = "reference-results empty";
    referenceResultsEl.textContent = "No results yet.";
    referenceResults = [];
    selectedComponentIndex = null;
    componentProperties = [];
    componentPropertiesName = "";
    nodeProperties = [];
    nodePropertiesStatus = "idle";
    nodePropertiesError = "";
  }
  updateSpineTraceToolVisibility(node);
  evalInPage(EVAL_SELECT(node.uuid), () => {});
  nodePropertiesStatus = "loading";
  renderDetail(node);
  loadNodeProperties(node.uuid);
  renderTree();
}

function isEditingComponentProperty() {
  const active = document.activeElement;
  return !!(active && detailEl.contains(active) && active.classList.contains("prop-value"));
}

function formatScalarPropValue(prop) {
  if (prop.type === "boolean") return prop.value ? "true" : "false";
  if (prop.type === "number") return String(prop.value);
  return prop.value == null ? "" : String(prop.value);
}

function formatFieldValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

function renderPropRowsHtml(properties, scope) {
  return properties
    .map((prop) => {
      const key = escapeHtml(prop.key);
      const scopeAttr = `data-prop-scope="${escapeHtml(scope)}"`;
      if (prop.type === "boolean") {
        return `
          <div class="prop-row" ${scopeAttr} data-prop-key="${key}" data-prop-type="boolean">
            <label title="${key}">${key}</label>
            <input class="prop-value" type="checkbox" ${prop.value ? "checked" : ""} />
          </div>
        `;
      }
      if (prop.fields?.length) {
        const inputs = prop.fields
          .map((field) => {
            const fieldName = escapeHtml(field);
            const fieldValue = escapeHtml(formatFieldValue(prop.value?.[field]));
            return `
              <label class="prop-vec-field">
                <span>${fieldName}</span>
                <input class="prop-value" data-field="${fieldName}" type="number" step="any" value="${fieldValue}" />
              </label>
            `;
          })
          .join("");
        return `
          <div class="prop-row prop-row-vector" ${scopeAttr} data-prop-key="${key}" data-prop-type="${escapeHtml(prop.type)}">
            <label title="${key}">${key}</label>
            <div class="prop-vec">${inputs}</div>
          </div>
        `;
      }
      if (prop.type === "number") {
        return `
          <div class="prop-row" ${scopeAttr} data-prop-key="${key}" data-prop-type="number">
            <label title="${key}">${key}</label>
            <input class="prop-value" type="number" step="any" value="${escapeHtml(formatScalarPropValue(prop))}" />
          </div>
        `;
      }
      return `
        <div class="prop-row" ${scopeAttr} data-prop-key="${key}" data-prop-type="string">
          <label title="${key}">${key}</label>
          <input class="prop-value" type="text" value="${escapeHtml(formatScalarPropValue(prop))}" />
        </div>
      `;
    })
    .join("");
}

function renderNodePropertiesHtml() {
  if (nodePropertiesStatus === "loading" || nodePropertiesStatus === "idle") {
    return `
      <div class="component-props">
        <h2>Node properties</h2>
        <div class="component-props empty">Loading node properties…</div>
      </div>
    `;
  }
  if (nodePropertiesStatus === "error") {
    return `
      <div class="component-props">
        <h2>Node properties</h2>
        <div class="component-props empty">${escapeHtml(nodePropertiesError || "Failed to load node properties.")}</div>
      </div>
    `;
  }
  if (!nodeProperties.length) {
    return `
      <div class="component-props">
        <h2>Node properties</h2>
        <div class="component-props empty">No editable node properties.</div>
      </div>
    `;
  }
  return `
    <div class="component-props">
      <h2>Node properties</h2>
      <div class="prop-list">${renderPropRowsHtml(nodeProperties, "node")}</div>
    </div>
  `;
}

function renderComponentPropertiesHtml() {
  if (selectedComponentIndex == null) {
    return `<div class="component-props empty">Click a component to inspect editable properties.</div>`;
  }
  if (!componentProperties.length) {
    return `
      <div class="component-props">
        <h2>${escapeHtml(componentPropertiesName || "Component")} properties</h2>
        <div class="component-props empty">No editable properties found.</div>
      </div>
    `;
  }

  return `
    <div class="component-props">
      <h2>${escapeHtml(componentPropertiesName || "Component")} properties</h2>
      <div class="prop-list">${renderPropRowsHtml(componentProperties, "component")}</div>
    </div>
  `;
}

function readPropRowValue(row, type) {
  if (type === "boolean") {
    return row.querySelector(".prop-value")?.checked;
  }
  const fields = [...row.querySelectorAll(".prop-value[data-field]")];
  if (fields.length) {
    const value = {};
    fields.forEach((input) => {
      value[input.getAttribute("data-field")] = Number(input.value);
    });
    return value;
  }
  const input = row.querySelector(".prop-value");
  if (!input) return undefined;
  if (type === "number") return input.value === "" ? NaN : Number(input.value);
  return input.value;
}

function applyPropResultToRow(row, type, resultValue) {
  if (type === "boolean") {
    const input = row.querySelector(".prop-value");
    if (input) input.checked = !!resultValue;
    return;
  }
  const fields = [...row.querySelectorAll(".prop-value[data-field]")];
  if (fields.length) {
    fields.forEach((input) => {
      if (document.activeElement === input) return;
      const field = input.getAttribute("data-field");
      input.value = formatFieldValue(resultValue?.[field]);
    });
    return;
  }
  const input = row.querySelector(".prop-value");
  if (input && document.activeElement !== input) {
    input.value = formatScalarPropValue({ type, value: resultValue });
  }
}

function bindPropertyEditors(node) {
  detailEl.querySelectorAll(".prop-row").forEach((row) => {
    const scope = row.getAttribute("data-prop-scope");
    const key = row.getAttribute("data-prop-key");
    const type = row.getAttribute("data-prop-type");
    const inputs = [...row.querySelectorAll(".prop-value")];
    if (!scope || !key || !inputs.length) return;

    const commit = () => {
      const value = readPropRowValue(row, type);
      const expression =
        scope === "node"
          ? EVAL_SET_NODE_PROP(node.uuid, key, value)
          : selectedComponentIndex == null
            ? null
            : EVAL_SET_COMPONENT_PROP(node.uuid, selectedComponentIndex, key, value);
      if (!expression) return;

      evalInPage(expression, (result, err) => {
        if (err || !result?.ok) {
          setToolStatus(result?.error || err || "Failed to set property.", "error");
          if (scope === "node") loadNodeProperties(node.uuid);
          else loadComponentProperties(node.uuid, selectedComponentIndex);
          return;
        }
        if (scope === "node") {
          const prop = nodeProperties.find((item) => item.key === key);
          if (prop) prop.value = result.value;
        } else {
          const prop = componentProperties.find((item) => item.key === key);
          if (prop) prop.value = result.value;
        }
        applyPropResultToRow(row, type, result.value);
        const label = scope === "node" ? "node" : componentPropertiesName || "component";
        const display =
          result.fields?.length && result.value && typeof result.value === "object"
            ? result.fields.map((field) => `${field}:${result.value[field]}`).join(", ")
            : String(result.value);
        setToolStatus(`Set ${label}.${key} = ${display}`, "ok");
        if (scope === "node" && (key === "active" || key === "name")) {
          // hierarchy labels / active state may change
          refresh();
        }
      });
    };

    inputs.forEach((input) => {
      if (type === "boolean") {
        input.addEventListener("change", commit);
      } else {
        input.addEventListener("change", commit);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          }
        });
      }
    });
  });
}

function loadNodeProperties(uuid, options = {}) {
  const { silent = false } = options;
  if (!silent || nodePropertiesStatus !== "ready") {
    nodePropertiesStatus = "loading";
    nodePropertiesError = "";
  }
  evalInPage(EVAL_GET_NODE_PROPS(uuid), (result, err) => {
    if (selectedUuid !== uuid) return;
    if (err || !result?.ok) {
      if (!silent || nodePropertiesStatus !== "ready") {
        nodeProperties = [];
        nodePropertiesStatus = "error";
        nodePropertiesError = result?.error || err || "Failed to load node properties.";
      }
      if (!silent) setToolStatus(result?.error || err || "Failed to load node properties.", "error");
      if (!isEditingComponentProperty()) {
        const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
        if (node) renderDetail(node);
      }
      return;
    }
    nodeProperties = result.properties || [];
    nodePropertiesStatus = "ready";
    nodePropertiesError = "";
    if (!isEditingComponentProperty()) {
      const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
      if (node) renderDetail(node);
    }
  });
}

function loadComponentProperties(uuid, componentIndex, options = {}) {
  const { silent = false } = options;
  evalInPage(EVAL_GET_COMPONENT_PROPS(uuid, componentIndex), (result, err) => {
    if (err || !result?.ok) {
      componentProperties = [];
      componentPropertiesName = "";
      if (!silent) setToolStatus(result?.error || err || "Failed to load properties.", "error");
      const node = hierarchy?.tree && selectedUuid ? findNode(hierarchy.tree, selectedUuid) : null;
      if (node && !isEditingComponentProperty()) renderDetail(node);
      return;
    }
    componentProperties = result.properties || [];
    componentPropertiesName = result.componentName || "Component";
    const node = hierarchy?.tree && selectedUuid ? findNode(hierarchy.tree, selectedUuid) : null;
    if (node && !isEditingComponentProperty()) renderDetail(node);
  });
}

function renderDetail(node) {
  if (!node) {
    detailEl.className = "detail empty";
    detailEl.textContent = "Select a node";
    selectedComponentIndex = null;
    componentProperties = [];
    componentPropertiesName = "";
    nodeProperties = [];
    nodePropertiesStatus = "idle";
    nodePropertiesError = "";
    return;
  }

  detailEl.className = "detail";
  const comps = node.components
    .map((c, i) => {
      const isSpine = /spine|skeleton/i.test(c);
      const selected = selectedComponentIndex === i ? " selected" : "";
      return `<button class="component${isSpine ? " spine" : ""}${selected}" data-component-index="${i}" type="button" title="Inspect properties and set as $c">${escapeHtml(c)}</button>`;
    })
    .join("");

  detailEl.innerHTML = `
    <table>
      <tr><th>UUID</th><td style="font-family:var(--mono);font-size:10px;word-break:break-all">${escapeHtml(node.uuid)}</td></tr>
      <tr><th>In Hierarchy</th><td>${node.activeInHierarchy ? "Yes" : "No"}</td></tr>
      <tr><th>Children</th><td>${node.childCount}</td></tr>
    </table>
    ${renderNodePropertiesHtml()}
    <div class="components">
      <h2>Components</h2>
      ${comps || '<span style="color:var(--text-dim)">None</span>'}
    </div>
    ${renderComponentPropertiesHtml()}
    <div class="detail-actions">
      <button id="btn-log">Log to Console</button>
      <button id="btn-toggle">${node.active ? "Deactivate" : "Activate"}</button>
    </div>
  `;

  document.getElementById("btn-log").addEventListener("click", () => {
    evalInPage(EVAL_SELECT(node.uuid), () => {});
  });

  document.getElementById("btn-toggle").addEventListener("click", () => {
    evalInPage(EVAL_TOGGLE(node.uuid), () => refresh());
  });

  detailEl.querySelectorAll("[data-component-index]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(el.getAttribute("data-component-index"));
      selectedComponentIndex = index;
      componentProperties = [];
      componentPropertiesName = node.components[index] || "Component";
      renderDetail(node);
      evalInPage(EVAL_SELECT_COMPONENT(node.uuid, index), (ok) => {
        if (ok) {
          setToolStatus(`Selected component set to $c (${node.components[index] || "Component"})`, "ok");
        } else {
          setToolStatus("Failed to select component.", "error");
        }
      });
      loadComponentProperties(node.uuid, index);
    });
  });

  bindPropertyEditors(node);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function refresh() {
  evalInPage(EVAL_GET_HIERARCHY, (result, err) => {
    if (err) {
      hierarchy = { ok: false, error: err };
      setStatus(err, "error");
      renderTree();
      return;
    }

    hierarchy = result;
    if (!result?.ok) {
      setStatus(result?.error || "Cocos not ready", "error");
      renderTree();
      return;
    }

    setStatus(`${result.sceneName} · CC ${result.engineVersion}`, "ok");

    updateComponentFilterOptions();

    if (selectedUuid && hierarchy.tree) {
      const node = findNode(hierarchy.tree, selectedUuid);
      if (node) {
        updateSpineTraceToolVisibility(node);
        if (isEditingComponentProperty()) {
          // Keep editors intact while typing.
        } else {
          renderDetail(node);
          loadNodeProperties(node.uuid, { silent: true });
          if (selectedComponentIndex != null) {
            loadComponentProperties(node.uuid, selectedComponentIndex, { silent: true });
          }
        }
      } else {
        selectedUuid = null;
        selectedComponentIndex = null;
        componentProperties = [];
        componentPropertiesName = "";
        nodeProperties = [];
        nodePropertiesStatus = "idle";
        nodePropertiesError = "";
        updateSpineTraceToolVisibility(null);
      }
    } else {
      updateSpineTraceToolVisibility(null);
    }

    renderTree();
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (autoRefreshEl.checked) {
    refreshTimer = setInterval(refresh, 1500);
  }
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

refreshBtn.addEventListener("click", refresh);
autoRefreshEl.addEventListener("change", startAutoRefresh);
searchEl.addEventListener("input", () => {
  nameFilter = searchEl.value.trim();
  updateClearFiltersButton();
  renderTree();
});
componentFilterEl.addEventListener("change", () => {
  componentFilter = componentFilterEl.value;
  updateClearFiltersButton();
  renderTree();
});
clearFiltersBtn.addEventListener("click", () => {
  nameFilter = "";
  componentFilter = "";
  searchEl.value = "";
  componentFilterEl.value = "";
  resetExpansionForFilters();
  updateClearFiltersButton();
  renderTree();
});
expandAllBtn.addEventListener("click", expandAll);
collapseAllBtn.addEventListener("click", collapseAll);
findRefsBtn.addEventListener("click", () => {
  const uuid = (refUuidInputEl.value || selectedUuid || "").trim();
  if (!uuid) {
    setToolStatus("Enter/select a node UUID first.", "error");
    return;
  }
  evalInPage(EVAL_FIND_REFS(uuid), (result, err) => {
    if (err) {
      setToolStatus(err, "error");
      return;
    }
    if (!result?.ok) {
      setToolStatus(result?.error || "Failed to find references.", "error");
      setReferenceResults([]);
      return;
    }
    highlightedReferenceNodeUuid = null;
    setReferenceResults(result.hits || []);
    setToolStatus(`Found ${result.count} reference(s). Click a result to focus in tree.`, "ok");
    console.groupCollapsed(`[AnimTracer] Node references for ${result.target?.name || uuid}`);
    console.log("Target:", result.target);
    console.table(result.hits || []);
    console.groupEnd();
  });
});
traceSpineBtn.addEventListener("click", () => {
  if (spineTraceToolEl.hidden) {
    setToolStatus("Select a node with Skeleton/Spine component first.", "error");
    return;
  }
  const uuid = (refUuidInputEl.value || selectedUuid || "").trim();
  const animationName = (spineAnimationInputEl.value || "").trim();
  if (!uuid) {
    setToolStatus("Enter/select a node UUID first.", "error");
    return;
  }
  if (!animationName) {
    setToolStatus("Enter an animation name to trace.", "error");
    return;
  }
  evalInPage(EVAL_TRACE_SPINE(uuid, animationName), (result, err) => {
    if (err) {
      setToolStatus(err, "error");
      return;
    }
    if (!result?.ok) {
      setToolStatus(result?.error || "Failed to attach trace.", "error");
      return;
    }
    setToolStatus(result.message || "Spine trace attached.", "ok");
  });
});
clearSpineTraceBtn.addEventListener("click", () => {
  if (spineTraceToolEl.hidden) {
    setToolStatus("Select a node with Skeleton/Spine component first.", "error");
    return;
  }
  const uuid = (refUuidInputEl.value || selectedUuid || "").trim();
  if (!uuid) {
    setToolStatus("Enter/select a node UUID first.", "error");
    return;
  }
  evalInPage(EVAL_CLEAR_SPINE_TRACE(uuid), (result, err) => {
    if (err) {
      setToolStatus(err, "error");
      return;
    }
    if (!result?.ok) {
      setToolStatus(result?.error || "Failed to clear trace.", "error");
      return;
    }
    setToolStatus(result.message || "Spine trace cleared.", "ok");
  });
});
spineAnimationInputEl.addEventListener("focus", loadSpineAnimationSuggestions);
spineAnimationInputEl.addEventListener("input", () => {
  if (!spineAnimationNames.length) return;
  renderSpineAnimationSuggestions(spineAnimationInputEl.value);
});
spineAnimationInputEl.addEventListener("blur", () => {
  setTimeout(() => {
    spineAnimationSuggestionListEl.hidden = true;
  }, 120);
});
gameSpeedRangeEl.addEventListener("input", () => {
  applyGameSpeed(gameSpeedRangeEl.value);
});
gameSpeedInputEl.addEventListener("change", () => {
  applyGameSpeed(gameSpeedInputEl.value);
});
document.querySelectorAll(".speed-snap").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyGameSpeed(btn.dataset.speed);
  });
});
pauseResumeBtnEl.addEventListener("click", togglePauseResume);
themeToggleBtnEl.addEventListener("click", (event) => {
  toggleThemePreference(event.shiftKey);
});

function connectPort() {
  try {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    port = chrome.runtime.connect({ name: `cocos-hierarchy-panel-${tabId}` });
    port.onMessage.addListener((msg) => {
      if (msg.type === "cocos-hierarchy-event" && msg.payload?.type === "scene-changed") {
        refresh();
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectPort, 1000);
    });
  } catch {
  }
}

connectPort();
initTheme();
initToolsPanelToggle();
initToolsPanelResizer();
setBuildNote();
syncGameSpeedFromPage();
syncPauseStateFromPage();
updateSpineTraceToolVisibility(null);
refresh();
startAutoRefresh();
