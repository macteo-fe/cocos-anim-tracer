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
const breakNodeTargetEl = document.getElementById("break-node-target");
const breakEventTypeEl = document.getElementById("break-event-type");
const addNodeBreakBtn = document.getElementById("btn-add-node-break");
const clearNodeBreaksBtn = document.getElementById("btn-clear-node-breaks");
const nodeBreakListEl = document.getElementById("node-break-list");
const gameSpeedRangeEl = document.getElementById("game-speed-range");
const gameSpeedInputEl = document.getElementById("game-speed-input");
const pauseResumeBtnEl = document.getElementById("btn-pause-resume");
const themeToggleBtnEl = document.getElementById("btn-theme-toggle");
const toolsToggleBtnEl = document.getElementById("btn-toggle-tools");
const toolsSettingsBtnEl = document.getElementById("btn-tool-settings");
const toolsPanelEl = document.getElementById("tools-panel");
const toolSettingsOverlayEl = document.getElementById("tool-settings-overlay");
const closeToolSettingsBtnEl = document.getElementById("btn-close-tool-settings");
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
let refreshInFlight = false;
let refreshQueued = false;
let lastHierarchyRaw = "";
let lastNodePropsRaw = "";
let lastNodePropsUuid = "";
let lastComponentPropsRaw = "";
let lastComponentPropsKey = "";
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
let boneTreeOpen = false;
let boneTreeUuid = null;
let boneTreeComponentIndex = null;
let boneTree = [];
let boneTreeCount = 0;
let boneTreeStatus = "idle"; // idle | loading | ready | error
let boneTreeError = "";
let boneTreeCollapsed = new Set();
let boneNameFilter = "";
let hoverBoneName = null;
let hoverBoneTimer = null;
let clearBoneTimer = null;
let componentPropListHeight = null;
let componentPropListResizing = false;
let componentPropListScrollTop = 0;
let nodePropListScrollTop = 0;
let boneTreeHeight = null;
let boneTreeResizing = false;
let boneTreeScrollTop = 0;
let detailRenderTimer = null;
let detailPointerActive = false;
let detailRefreshPending = false;
const TOOLS_MIN_WIDTH = 260;
const TREE_MIN_WIDTH = 300;
const TREE_MAX_WIDTH = 900;
const THEME_STORAGE_KEY = "animtracer-theme-preference";
const TOOLS_PANEL_STORAGE_KEY = "animtracer-tools-panel-open";
const TOOL_FEATURES_STORAGE_KEY = "animtracer-tool-features";
const MARKED_NODES_STORAGE_KEY = "animtracer-marked-node-uuids";
const DEFAULT_TOOL_FEATURES = {
  "game-speed": true,
  "find-refs": true,
  "spine-trace": true,
  "node-breaks": true,
};

let themePreference = "auto";
let markedNodes = new Map(); // uuid -> { color }
const MARK_COLOR_PALETTE = [
  "#f94144",
  "#f3722c",
  "#f8961e",
  "#90be6d",
  "#43aa8b",
  "#4d908e",
  "#577590",
  "#277da1",
  "#9b5de5",
  "#f15bb5",
  "#00bbf9",
  "#00f5d4",
  "#fee440",
  "#ff6b6b",
  "#48cae4",
  "#b5179e",
];
let toolFeatures = { ...DEFAULT_TOOL_FEATURES };

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
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.getNodeProperties !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page", properties: [] };
  }
  try {
    return bridge.getNodeProperties(${JSON.stringify(uuid)});
  } catch (err) {
    return { ok: false, error: err?.message || String(err), properties: [] };
  }
})()`;

const EVAL_SET_NODE_PROP = (uuid, key, value) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.setNodeProperty !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  try {
    return bridge.setNodeProperty(
      ${JSON.stringify(uuid)},
      ${JSON.stringify(key)},
      ${JSON.stringify(value)}
    );
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
})()`;

const EVAL_FIND_REFS = (uuid) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.findNodeReferences !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.findNodeReferences(${JSON.stringify(uuid)});
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

const EVAL_REGISTER_NODE_BREAK = (uuid, eventType) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.registerNodeEventBreak !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.registerNodeEventBreak(${JSON.stringify(uuid)}, ${JSON.stringify(eventType)});
})()`;

const EVAL_CLEAR_NODE_BREAKS = `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.clearNodeEventBreaks !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.clearNodeEventBreaks();
})()`;

const EVAL_CLEAR_ONE_NODE_BREAK = (uuid, eventType) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.clearNodeEventBreaks !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.clearNodeEventBreaks(${JSON.stringify(uuid)}, ${JSON.stringify(eventType)});
})()`;

const EVAL_GET_NODE_BREAKS = `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.getNodeEventBreaks !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page", breaks: [] };
  }
  return bridge.getNodeEventBreaks();
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

const EVAL_GET_SKELETON_BONES = (uuid, componentIndex) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.getSkeletonBoneTree !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page", bones: [] };
  }
  return bridge.getSkeletonBoneTree(${JSON.stringify(uuid)}, ${JSON.stringify(componentIndex)});
})()`;

const EVAL_HIGHLIGHT_BONE = (uuid, boneName, componentIndex) => `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.highlightSkeletonBone !== "function") {
    return { ok: false, error: "Bridge outdated — refresh the game page" };
  }
  return bridge.highlightSkeletonBone(
    ${JSON.stringify(uuid)},
    ${JSON.stringify(boneName)},
    ${JSON.stringify(componentIndex)}
  );
})()`;

const EVAL_CLEAR_BONE_HIGHLIGHT = `(() => {
  const bridge = window.__cocosHierarchyBridge__;
  if (!bridge || typeof bridge.clearSkeletonBoneHighlight !== "function") {
    return { ok: false };
  }
  return bridge.clearSkeletonBoneHighlight();
})()`;

function wrapEvalExpression(expression) {
  // Return JSON strings instead of object graphs. Chrome's inspector protocol
  // is extremely slow when Runtime.evaluate returns a large object (it walks
  // every property for the frontend preview).
  return `(() => {
    try {
      const __r = (${expression});
      if (__r !== null && typeof __r === "object") return JSON.stringify(__r);
      return __r;
    } catch (e) {
      return JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })()`;
}

function parseEvalResult(result) {
  if (typeof result !== "string") return result;
  const first = result.charAt(0);
  if (first !== "{" && first !== "[") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function evalInPage(expression, callback, options = {}) {
  chrome.devtools.inspectedWindow.eval(wrapEvalExpression(expression), (result, exceptionInfo) => {
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
    if (typeof options.unchangedRaw === "string" && options.unchangedRaw.length > 0 && result === options.unchangedRaw) {
      callback(null, null, result, true);
      return;
    }
    callback(parseEvalResult(result), null, result, false);
  });
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function setToolStatus(text, type = "") {
  toolStatusEl.textContent = text;
  toolStatusEl.title = text;
  toolStatusEl.className = `tool-status ${type}`;
}

function updateBreakNodeTargetLabel(node = null) {
  const resolved =
    node ||
    (hierarchy?.tree && selectedUuid ? findNode(hierarchy.tree, selectedUuid) : null);
  if (!resolved || !selectedUuid) {
    breakNodeTargetEl.textContent = "Not selected";
    breakNodeTargetEl.classList.remove("has-node");
    breakNodeTargetEl.title = "";
    return;
  }
  const label = `${resolved.name || "(unnamed)"} · ${resolved.uuid}`;
  breakNodeTargetEl.textContent = label;
  breakNodeTargetEl.classList.add("has-node");
  breakNodeTargetEl.title = label;
}

function formatBreakEventType(eventType) {
  switch (eventType) {
    case "parent-change":
      return "parent-change";
    case "active-change":
      return "active-change";
    case "add-child":
      return "add-child";
    case "remove-child":
      return "remove-child";
    case "transform-change":
      return "transform-change";
    default:
      return eventType || "unknown";
  }
}

function renderNodeBreakList(items) {
  const breaks = Array.isArray(items) ? items : [];
  if (!breaks.length) {
    nodeBreakListEl.className = "node-break-list empty";
    nodeBreakListEl.textContent = "No breaks registered.";
    return;
  }
  nodeBreakListEl.className = "node-break-list";
  nodeBreakListEl.innerHTML = "";
  breaks.forEach((entry) => {
    const target = entry.uuid === "*" ? "all nodes" : entry.uuid;
    const row = document.createElement("div");
    row.className = "node-break-item";
    row.innerHTML = `
      <span class="node-break-type">${escapeHtml(formatBreakEventType(entry.eventType))}</span>
      <span class="node-break-target" title="${escapeHtml(target)}">@ ${escapeHtml(target)}</span>
    `;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "node-break-remove";
    removeBtn.title = "Remove this break";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      clearOneNodeBreak(entry.uuid, entry.eventType);
    });
    row.appendChild(removeBtn);
    nodeBreakListEl.appendChild(row);
  });
}

function refreshNodeBreakList() {
  evalInPage(EVAL_GET_NODE_BREAKS, (result, err) => {
    if (err || !result?.ok) {
      renderNodeBreakList([]);
      return;
    }
    renderNodeBreakList(result.breaks || []);
  });
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

function isToolFeatureEnabled(featureId) {
  return toolFeatures[featureId] !== false;
}

function loadToolFeatures() {
  try {
    const raw = localStorage.getItem(TOOL_FEATURES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    toolFeatures = { ...DEFAULT_TOOL_FEATURES, ...parsed };
  } catch {
    toolFeatures = { ...DEFAULT_TOOL_FEATURES };
  }
}

function saveToolFeatures() {
  try {
    localStorage.setItem(TOOL_FEATURES_STORAGE_KEY, JSON.stringify(toolFeatures));
  } catch {}
}

function syncToolSettingsForm() {
  toolSettingsOverlayEl.querySelectorAll("[data-tool-setting]").forEach((input) => {
    const key = input.getAttribute("data-tool-setting");
    input.checked = isToolFeatureEnabled(key);
  });
}

function applyToolFeatureVisibility() {
  document.querySelectorAll("[data-tool-feature]").forEach((el) => {
    const featureId = el.getAttribute("data-tool-feature");
    if (featureId === "spine-trace") return;
    el.hidden = !isToolFeatureEnabled(featureId);
  });

  const selectedNode =
    hierarchy?.tree && selectedUuid ? findNode(hierarchy.tree, selectedUuid) : null;
  updateSpineTraceToolVisibility(selectedNode);
}

function openToolSettings() {
  syncToolSettingsForm();
  toolSettingsOverlayEl.hidden = false;
}

function closeToolSettings() {
  toolSettingsOverlayEl.hidden = true;
}

function initToolFeatureSettings() {
  loadToolFeatures();
  applyToolFeatureVisibility();

  toolsSettingsBtnEl.addEventListener("click", () => {
    if (toolSettingsOverlayEl.hidden) openToolSettings();
    else closeToolSettings();
  });
  closeToolSettingsBtnEl.addEventListener("click", closeToolSettings);
  toolSettingsOverlayEl.addEventListener("click", (event) => {
    if (event.target === toolSettingsOverlayEl) closeToolSettings();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !toolSettingsOverlayEl.hidden) {
      closeToolSettings();
    }
  });

  toolSettingsOverlayEl.querySelectorAll("[data-tool-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-tool-setting");
      if (!key || !(key in DEFAULT_TOOL_FEATURES)) return;
      toolFeatures[key] = !!input.checked;
      saveToolFeatures();
      applyToolFeatureVisibility();
    });
  });
}

function initToolsPanelResizer() {
  let isDragging = false;

  const applyTreeWidth = (width) => {
    document.documentElement.style.setProperty("--tree-width", `${Math.round(width)}px`);
  };

  const clampTreeWidth = (desired, layoutWidth) => {
    const maxAllowed = Math.max(TREE_MIN_WIDTH, layoutWidth - TOOLS_MIN_WIDTH - 6);
    return Math.min(Math.max(desired, TREE_MIN_WIDTH), Math.min(TREE_MAX_WIDTH, maxAllowed));
  };

  // Start hierarchy at its minimum width.
  applyTreeWidth(TREE_MIN_WIDTH);

  const onPointerMove = (event) => {
    if (!isDragging) return;
    const rect = layoutEl.getBoundingClientRect();
    const leftSideWidth = event.clientX - rect.left;
    applyTreeWidth(clampTreeWidth(leftSideWidth, rect.width));
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
  if (hoverBoneTimer) {
    clearTimeout(hoverBoneTimer);
    hoverBoneTimer = null;
  }
  if (hoverBoneName) {
    hoverBoneName = null;
    evalInPage(EVAL_CLEAR_BONE_HIGHLIGHT, () => {});
  }
  if (hoverHighlightTimer) clearTimeout(hoverHighlightTimer);
  hoverHighlightTimer = setTimeout(() => {
    hoverHighlightTimer = null;
    highlightNodeInGame(uuid);
  }, 50);
}

function highlightBoneInGame(uuid, boneName, componentIndex) {
  const id = String(uuid || "").trim();
  const name = String(boneName || "").trim();
  if (!id || !name) return;
  if (clearBoneTimer) {
    clearTimeout(clearBoneTimer);
    clearBoneTimer = null;
  }
  if (hoverHighlightTimer) {
    clearTimeout(hoverHighlightTimer);
    hoverHighlightTimer = null;
  }
  if (clearHighlightTimer) {
    clearTimeout(clearHighlightTimer);
    clearHighlightTimer = null;
  }
  hoverHighlightUuid = null;
  if (hoverBoneName === name) return;
  hoverBoneName = name;
  evalInPage(EVAL_HIGHLIGHT_BONE(id, name, componentIndex), () => {});
}

function clearBoneHighlightInGame() {
  if (hoverBoneTimer) {
    clearTimeout(hoverBoneTimer);
    hoverBoneTimer = null;
  }
  if (clearBoneTimer) clearTimeout(clearBoneTimer);
  clearBoneTimer = setTimeout(() => {
    clearBoneTimer = null;
    hoverBoneName = null;
    evalInPage(EVAL_CLEAR_BONE_HIGHLIGHT, () => {});
  }, 40);
}

function scheduleBoneHighlight(uuid, boneName, componentIndex) {
  if (clearBoneTimer) {
    clearTimeout(clearBoneTimer);
    clearBoneTimer = null;
  }
  if (hoverBoneTimer) clearTimeout(hoverBoneTimer);
  hoverBoneTimer = setTimeout(() => {
    hoverBoneTimer = null;
    highlightBoneInGame(uuid, boneName, componentIndex);
  }, 50);
}

function isSkeletonComponentName(name) {
  return /spine|skeleton/i.test(String(name || ""));
}

function resetBoneTreeState() {
  boneTreeOpen = false;
  boneTreeUuid = null;
  boneTreeComponentIndex = null;
  boneTree = [];
  boneTreeCount = 0;
  boneTreeStatus = "idle";
  boneTreeError = "";
  boneTreeCollapsed = new Set();
  boneNameFilter = "";
  hoverBoneName = null;
  if (hoverBoneTimer) {
    clearTimeout(hoverBoneTimer);
    hoverBoneTimer = null;
  }
  if (clearBoneTimer) {
    clearTimeout(clearBoneTimer);
    clearBoneTimer = null;
  }
  evalInPage(EVAL_CLEAR_BONE_HIGHLIGHT, () => {});
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
  const featureOn = isToolFeatureEnabled("spine-trace");
  const visible = featureOn && nodeHasSkeletonComponent(node);
  spineTraceToolEl.hidden = !visible;
  if (!visible) {
    spineAnimationInputEl.value = "";
    spineAnimationSuggestionsEl.innerHTML = "";
    spineAnimationSuggestionListEl.hidden = true;
    spineAnimationSuggestionListEl.innerHTML = "";
    spineAnimationNames = [];
  }
}

function registerNodeBreakFromUI() {
  const uuid = String(selectedUuid || "").trim();
  const eventType = (breakEventTypeEl.value || "").trim();
  if (!uuid) {
    setToolStatus("Select a node first.", "error");
    return;
  }
  if (!eventType) {
    setToolStatus("Select a break event type.", "error");
    return;
  }
  evalInPage(EVAL_REGISTER_NODE_BREAK(uuid, eventType), (result, err) => {
    if (err || !result?.ok) {
      setToolStatus(result?.error || err || "Failed to register break.", "error");
      return;
    }
    renderNodeBreakList(result.breaks || []);
    const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
    const targetLabel = node ? `${node.name || "(unnamed)"} · ${uuid}` : uuid;
    setToolStatus(
      result.added
        ? `Break added: ${formatBreakEventType(eventType)} @ ${targetLabel}`
        : `Break already exists: ${formatBreakEventType(eventType)} @ ${targetLabel}`,
      "ok"
    );
  });
}

function clearNodeBreaksFromUI() {
  evalInPage(EVAL_CLEAR_NODE_BREAKS, (result, err) => {
    if (err || !result?.ok) {
      setToolStatus(result?.error || err || "Failed to clear breaks.", "error");
      return;
    }
    renderNodeBreakList(result.breaks || []);
    setToolStatus(`Cleared ${result.cleared || 0} node break(s).`, "ok");
  });
}

function clearOneNodeBreak(uuid, eventType) {
  evalInPage(EVAL_CLEAR_ONE_NODE_BREAK(uuid, eventType), (result, err) => {
    if (err || !result?.ok) {
      setToolStatus(result?.error || err || "Failed to clear break.", "error");
      return;
    }
    renderNodeBreakList(result.breaks || []);
    const targetLabel = uuid === "*" ? "all nodes" : uuid;
    setToolStatus(
      result.cleared
        ? `Removed break: ${formatBreakEventType(eventType)} @ ${targetLabel}`
        : "Break not found.",
      result.cleared ? "ok" : "error"
    );
  });
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

function highlightReferenceNode(nodeUuid) {
  if (!hierarchy?.tree || !nodeUuid) return;
  expansionMode = "default";
  expandPathToNode(hierarchy.tree, nodeUuid);
  highlightedReferenceNodeUuid = nodeUuid;
  renderTree();
  setReferenceResults(referenceResults);
}

function focusReferenceHolder(nodeUuid) {
  if (!hierarchy?.tree || !nodeUuid) return;
  highlightReferenceNode(nodeUuid);
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
    updateBreakNodeTargetLabel(node);
    evalInPage(EVAL_SELECT(nodeUuid), () => {});
    nodePropertiesStatus = "loading";
    renderDetail(node);
    loadNodeProperties(nodeUuid);
  }
}

function updateClearFiltersButton() {
  clearFiltersBtn.hidden = !hasActiveFilters();
}

function loadMarkedNodes() {
  try {
    const raw = localStorage.getItem(MARKED_NODES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    markedNodes = new Map();
    if (Array.isArray(parsed)) {
      parsed.forEach((entry) => {
        if (typeof entry === "string") {
          const uuid = String(entry || "").trim();
          if (uuid) markedNodes.set(uuid, { color: allocateMarkColor() });
          return;
        }
        if (!entry || typeof entry !== "object") return;
        const uuid = String(entry.uuid || "").trim();
        if (!uuid) return;
        const color = normalizeMarkColor(entry.color) || allocateMarkColor();
        markedNodes.set(uuid, { color });
      });
      saveMarkedNodes();
    }
  } catch {}
}

function saveMarkedNodes() {
  try {
    const payload = [...markedNodes.entries()].map(([uuid, meta]) => ({
      uuid,
      color: meta.color,
    }));
    localStorage.setItem(MARKED_NODES_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

function normalizeMarkColor(color) {
  const value = String(color || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return "";
}

function allocateMarkColor() {
  const used = new Set([...markedNodes.values()].map((meta) => String(meta.color || "").toLowerCase()));
  const unused = MARK_COLOR_PALETTE.filter((color) => !used.has(color.toLowerCase()));
  if (unused.length) {
    return unused[Math.floor(Math.random() * unused.length)];
  }
  // Fallback when palette is exhausted: random distinct-ish hue.
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 72, 54);
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isMarkedNode(uuid) {
  return markedNodes.has(String(uuid || "").trim());
}

function getMarkedNodeColor(uuid) {
  return markedNodes.get(String(uuid || "").trim())?.color || "";
}

function toggleMarkedNode(uuid) {
  const id = String(uuid || "").trim();
  if (!id) return false;
  let marked = false;
  if (markedNodes.has(id)) {
    markedNodes.delete(id);
    marked = false;
  } else {
    markedNodes.set(id, { color: allocateMarkColor() });
    marked = true;
  }
  saveMarkedNodes();
  return marked;
}

function ensureExpandedForMarkedNode(root) {
  if (!root || !markedNodes.size) return;
  expansionMode = "default";
  for (const uuid of markedNodes.keys()) {
    expandPathToNode(root, uuid);
  }
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
  ensureExpandedForMarkedNode(hierarchy.tree);

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
  const isMarked = isMarkedNode(node.uuid);
  const markColor = isMarked ? getMarkedNodeColor(node.uuid) : "";
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
  if (isMarked) {
    row.classList.add("marked-highlight");
    if (markColor) {
      row.style.setProperty("--mark-color", markColor);
      row.style.setProperty("--mark-color-bg", `${markColor}33`);
    }
  }
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

  const markBtn = document.createElement("button");
  markBtn.type = "button";
  markBtn.className = `mark-toggle${isMarked ? " active" : ""}`;
  markBtn.textContent = "★";
  markBtn.title = isMarked ? "Unmark node" : "Mark node";
  if (isMarked && markColor) {
    markBtn.style.color = markColor;
  }
  markBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const marked = toggleMarkedNode(node.uuid);
    setToolStatus(marked ? `Marked ${node.name}` : `Unmarked ${node.name}`, "ok");
    renderTree();
  });
  row.appendChild(markBtn);

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
    resetBoneTreeState();
  }
  updateSpineTraceToolVisibility(node);
  updateBreakNodeTargetLabel(node);
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

function isEditingBoneSearch() {
  const active = document.activeElement;
  return !!(active && active.id === "bone-tree-search");
}

function isDetailInteractionLocked() {
  return isEditingComponentProperty() || isEditingBoneSearch() || detailPointerActive || componentPropListResizing || boneTreeResizing || !!hoverBoneName;
}

function releaseDetailPointerLock() {
  detailPointerActive = false;
  if (componentPropListResizing) {
    persistComponentPropListHeight();
  }
  if (boneTreeResizing) {
    persistBoneTreeHeight();
  }
  // Wait a tick so click-to-focus on inputs can settle before we decide.
  setTimeout(flushDetailRefreshIfIdle, 0);
}

function flushDetailRefreshIfIdle() {
  if (!detailRefreshPending) return;
  if (isDetailInteractionLocked()) return;
  detailRefreshPending = false;
  const node = hierarchy?.tree && selectedUuid ? findNode(hierarchy.tree, selectedUuid) : null;
  if (node) scheduleRenderDetail(node);
}

function markDetailPointerActive() {
  detailPointerActive = true;
}

function requestDetailRender(node, options = {}) {
  const { immediate = false, silent = false } = options;
  if (!node) return;
  if (silent && isDetailInteractionLocked()) {
    detailRefreshPending = true;
    return;
  }
  scheduleRenderDetail(node, { immediate });
}

function capturePropListScroll() {
  const componentList = document.getElementById("component-prop-list");
  if (componentList) componentPropListScrollTop = componentList.scrollTop;
  const nodeList = document.getElementById("node-prop-list");
  if (nodeList) nodePropListScrollTop = nodeList.scrollTop;
  const boneTree = document.getElementById("bone-tree");
  if (boneTree) boneTreeScrollTop = boneTree.scrollTop;
}

function restorePropListScroll() {
  const restore = () => {
    const componentList = document.getElementById("component-prop-list");
    if (componentList) componentList.scrollTop = componentPropListScrollTop;
    const nodeList = document.getElementById("node-prop-list");
    if (nodeList) nodeList.scrollTop = nodePropListScrollTop;
    const boneTree = document.getElementById("bone-tree");
    if (boneTree) boneTree.scrollTop = boneTreeScrollTop;
  };
  restore();
  requestAnimationFrame(restore);
}

function scheduleRenderDetail(node, options = {}) {
  const { immediate = false } = options;
  if (!node) return;
  if (immediate) {
    if (detailRenderTimer) {
      clearTimeout(detailRenderTimer);
      detailRenderTimer = null;
    }
    if (isDetailInteractionLocked()) {
      detailRefreshPending = true;
      return;
    }
    renderDetail(node);
    return;
  }
  if (detailRenderTimer) clearTimeout(detailRenderTimer);
  detailRenderTimer = setTimeout(() => {
    detailRenderTimer = null;
    if (isDetailInteractionLocked()) {
      detailRefreshPending = true;
      return;
    }
    if (!selectedUuid || node.uuid !== selectedUuid) return;
    const current = hierarchy?.tree ? findNode(hierarchy.tree, selectedUuid) : node;
    if (current) renderDetail(current);
  }, 50);
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
      if (prop.type === "nodeRef" || prop.type === "componentRef") {
        const uuid = escapeHtml(prop.value?.uuid || "");
        const label =
          prop.type === "componentRef"
            ? `${prop.value?.componentName || "Component"} @ ${prop.value?.name || "(unnamed)"}`
            : prop.value?.name || "(unnamed)";
        const title = prop.value?.path || prop.value?.uuid || label;
        return `
          <div class="prop-row prop-row-ref" ${scopeAttr} data-prop-key="${key}" data-prop-type="${escapeHtml(prop.type)}">
            <label title="${key}">${key}</label>
            <button
              type="button"
              class="prop-ref-link"
              data-ref-uuid="${uuid}"
              title="${escapeHtml(title)}"
              ${uuid ? "" : "disabled"}
            >${escapeHtml(label)}</button>
          </div>
        `;
      }
      if (prop.type === "refList" && Array.isArray(prop.value)) {
        const links = prop.value
          .map((item, index) => {
            const uuid = escapeHtml(item.value?.uuid || "");
            const itemType = item.type || "nodeRef";
            const label =
              itemType === "componentRef"
                ? `[${index}] ${item.value?.componentName || "Component"} @ ${item.value?.name || "(unnamed)"}`
                : `[${index}] ${item.value?.name || "(unnamed)"}`;
            const title = item.value?.path || item.value?.uuid || label;
            return `
              <button
                type="button"
                class="prop-ref-link"
                data-ref-uuid="${uuid}"
                title="${escapeHtml(title)}"
                ${uuid ? "" : "disabled"}
              >${escapeHtml(label)}</button>
            `;
          })
          .join("");
        return `
          <div class="prop-row prop-row-ref" ${scopeAttr} data-prop-key="${key}" data-prop-type="refList">
            <label title="${key}">${key}</label>
            <div class="prop-ref-list">${links || '<span class="prop-ref-empty">Empty</span>'}</div>
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
      <div class="prop-list" id="node-prop-list">${renderPropRowsHtml(nodeProperties, "node")}</div>
    </div>
  `;
}

function getBoneNameFilter() {
  return String(boneNameFilter || "").trim().toLowerCase();
}

function boneMatchesSelf(bone) {
  const q = getBoneNameFilter();
  if (!q) return true;
  return String(bone?.name || "").toLowerCase().includes(q);
}

function boneMatchesTree(bone) {
  if (!bone) return false;
  if (boneMatchesSelf(bone)) return true;
  const children = Array.isArray(bone.children) ? bone.children : [];
  return children.some(boneMatchesTree);
}

function countMatchingBones(bones) {
  let count = 0;
  const walk = (list) => {
    for (const bone of list || []) {
      if (boneMatchesSelf(bone)) count++;
      walk(bone.children);
    }
  };
  walk(bones);
  return count;
}

function getBoneTreeTitleText() {
  if (!boneTreeCount) return "Skeleton bones";
  const q = getBoneNameFilter();
  if (!q) return `Skeleton bones (${boneTreeCount})`;
  return `Skeleton bones (${countMatchingBones(boneTree)}/${boneTreeCount})`;
}

function renderBoneNode(bone, depth, container) {
  if (!bone) return;
  const queryActive = !!getBoneNameFilter();
  if (queryActive && !boneMatchesTree(bone)) return;
  const children = Array.isArray(bone.children) ? bone.children : [];
  const hasChildren = children.length > 0;
  const collapsed = boneTreeCollapsed.has(bone.name);
  const isExpanded = hasChildren && (queryActive ? children.some(boneMatchesTree) : !collapsed);
  const isDirectMatch = queryActive && boneMatchesSelf(bone);

  const nodeEl = document.createElement("div");
  nodeEl.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row bone-row";
  if (isDirectMatch) row.classList.add("filter-match");
  row.dataset.boneName = bone.name;
  row.style.paddingLeft = `${depth * 12 + 4}px`;

  const toggle = document.createElement("span");
  toggle.className = `toggle ${hasChildren ? "clickable" : "empty"}`;
  toggle.textContent = hasChildren ? (isExpanded ? "▼" : "▶") : "";
  toggle.title = hasChildren ? "Expand/collapse" : "";
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!hasChildren) return;
    if (collapsed) boneTreeCollapsed.delete(bone.name);
    else boneTreeCollapsed.add(bone.name);
    renderBoneTreeContents();
  });

  const icon = document.createElement("span");
  icon.className = "node-icon";
  icon.textContent = hasChildren ? "🦴" : "•";

  const name = document.createElement("span");
  name.className = "node-name";
  name.textContent = bone.name || "(unnamed)";

  row.appendChild(toggle);
  row.appendChild(icon);
  row.appendChild(name);
  row.addEventListener("mouseenter", () => {
    scheduleBoneHighlight(boneTreeUuid, bone.name, boneTreeComponentIndex);
  });
  row.addEventListener("mouseleave", () => clearBoneHighlightInGame());

  nodeEl.appendChild(row);
  if (hasChildren && isExpanded) {
    const childrenEl = document.createElement("div");
    childrenEl.className = "tree-children";
    for (const child of children) renderBoneNode(child, depth + 1, childrenEl);
    nodeEl.appendChild(childrenEl);
  }
  container.appendChild(nodeEl);
}

function renderBoneTreeHtml() {
  if (!boneTreeOpen || boneTreeUuid !== selectedUuid) return "";
  const heightStyle = boneTreeHeight ? `style="height:${boneTreeHeight}px"` : "";
  if (boneTreeStatus === "loading" || boneTreeStatus === "idle") {
    return `
      <div class="bone-tree-panel" id="bone-tree-panel">
        <div class="bone-tree-header">
          <h2>Skeleton bones</h2>
          <button type="button" id="btn-close-bone-tree" title="Close bone tree">✕</button>
        </div>
        <div class="bone-tree resizable empty" id="bone-tree" ${heightStyle}>Loading bones…</div>
      </div>
    `;
  }
  if (boneTreeStatus === "error") {
    return `
      <div class="bone-tree-panel" id="bone-tree-panel">
        <div class="bone-tree-header">
          <h2>Skeleton bones</h2>
          <button type="button" id="btn-close-bone-tree" title="Close bone tree">✕</button>
        </div>
        <div class="bone-tree resizable empty" id="bone-tree" ${heightStyle}>${escapeHtml(boneTreeError || "Failed to load bones.")}</div>
      </div>
    `;
  }
  return `
    <div class="bone-tree-panel" id="bone-tree-panel">
      <div class="bone-tree-header">
        <h2 id="bone-tree-title">${escapeHtml(getBoneTreeTitleText())}</h2>
        <button type="button" id="btn-close-bone-tree" title="Close bone tree">✕</button>
      </div>
      <div class="bone-tree-filter">
        <input
          type="search"
          id="bone-tree-search"
          placeholder="Filter by name…"
          value="${escapeHtml(boneNameFilter)}"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div class="bone-tree resizable" id="bone-tree" ${heightStyle}></div>
    </div>
  `;
}

function renderBoneTreeContents() {
  const tree = document.getElementById("bone-tree");
  if (!tree || boneTreeStatus !== "ready") return;
  if (!Array.isArray(boneTree) || !boneTree.length) return;

  tree.classList.remove("empty");
  tree.innerHTML = "";
  const query = String(boneNameFilter || "").trim();
  const hasVisible = !query || boneTree.some(boneMatchesTree);
  if (!hasVisible) {
    tree.classList.add("empty");
    tree.textContent = `No bones match "${query}".`;
  } else {
    for (const bone of boneTree) renderBoneNode(bone, 0, tree);
  }

  const title = document.getElementById("bone-tree-title");
  if (title) title.textContent = getBoneTreeTitleText();
}

function bindBoneTreeSearch() {
  const input = document.getElementById("bone-tree-search");
  if (!input) return;
  input.addEventListener("input", () => {
    boneNameFilter = input.value;
    renderBoneTreeContents();
  });
  input.addEventListener("keydown", (event) => event.stopPropagation());
}

function bindBoneTree() {
  const closeBtn = document.getElementById("btn-close-bone-tree");
  if (closeBtn) {
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetBoneTreeState();
      const node = hierarchy?.tree && selectedUuid ? findNode(hierarchy.tree, selectedUuid) : null;
      if (node) scheduleRenderDetail(node, { immediate: true });
    });
  }
  bindBoneTreeSearch();
  renderBoneTreeContents();
}

function openBoneTree(node, componentIndex) {
  if (!node) return;
  if (boneTreeOpen && boneTreeUuid === node.uuid && boneTreeComponentIndex === componentIndex) {
    resetBoneTreeState();
    scheduleRenderDetail(node, { immediate: true });
    return;
  }
  boneTreeOpen = true;
  boneTreeUuid = node.uuid;
  boneTreeComponentIndex = componentIndex;
  boneTree = [];
  boneTreeCount = 0;
  boneTreeStatus = "loading";
  boneTreeError = "";
  boneTreeCollapsed = new Set();
  boneNameFilter = "";
  scheduleRenderDetail(node, { immediate: true });
  evalInPage(EVAL_GET_SKELETON_BONES(node.uuid, componentIndex), (result, err) => {
    if (!boneTreeOpen || boneTreeUuid !== node.uuid || selectedUuid !== node.uuid) return;
    if (err || !result?.ok) {
      boneTree = [];
      boneTreeCount = 0;
      boneTreeStatus = "error";
      boneTreeError = result?.error || err || "Failed to load skeleton bones.";
      setToolStatus(boneTreeError, "error");
      scheduleRenderDetail(node, { immediate: true });
      return;
    }
    boneTree = result.bones || [];
    boneTreeCount = Number(result.boneCount) || boneTree.length;
    boneTreeStatus = "ready";
    boneTreeError = "";
    setToolStatus(`Opened bone tree (${boneTreeCount} bones). Hover a bone to preview it in-game.`, "ok");
    scheduleRenderDetail(node, { immediate: true });
  });
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
      <div
        class="prop-list resizable"
        id="component-prop-list"
        ${componentPropListHeight ? `style="height:${componentPropListHeight}px"` : ""}
      >${renderPropRowsHtml(componentProperties, "component")}</div>
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
  detailEl.querySelectorAll(".prop-ref-link").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const uuid = btn.getAttribute("data-ref-uuid");
      if (!uuid) {
        setToolStatus("Reference has no node UUID.", "error");
        return;
      }
      highlightReferenceNode(uuid);
      setToolStatus(`Highlighted ${btn.textContent.trim()}`, "ok");
    });
  });

  detailEl.querySelectorAll(".prop-row").forEach((row) => {
    const scope = row.getAttribute("data-prop-scope");
    const key = row.getAttribute("data-prop-key");
    const type = row.getAttribute("data-prop-type");
    if (type === "nodeRef" || type === "componentRef" || type === "refList") return;
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
      input.addEventListener("blur", () => {
        setTimeout(flushDetailRefreshIfIdle, 0);
      });
    });
  });
}

function loadNodeProperties(uuid, options = {}) {
  const { silent = false } = options;
  if (!silent || nodePropertiesStatus !== "ready") {
    nodePropertiesStatus = "loading";
    nodePropertiesError = "";
  }
  evalInPage(
    EVAL_GET_NODE_PROPS(uuid),
    (result, err, raw, unchanged) => {
      if (selectedUuid !== uuid) return;
      if (unchanged) return;
      lastNodePropsRaw = typeof raw === "string" ? raw : "";
      lastNodePropsUuid = uuid;
      if (err || !result?.ok) {
        if (!silent || nodePropertiesStatus !== "ready") {
          nodeProperties = [];
          nodePropertiesStatus = "error";
          nodePropertiesError = result?.error || err || "Failed to load node properties.";
        }
        if (!silent) setToolStatus(result?.error || err || "Failed to load node properties.", "error");
        const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
        if (node) requestDetailRender(node, { immediate: !silent, silent });
        return;
      }
      nodeProperties = result.properties || [];
      nodePropertiesStatus = "ready";
      nodePropertiesError = "";
      const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
      if (node) requestDetailRender(node, { immediate: !silent, silent });
    },
    { unchangedRaw: lastNodePropsUuid === uuid ? lastNodePropsRaw : "" }
  );
}

function loadComponentProperties(uuid, componentIndex, options = {}) {
  const { silent = false } = options;
  const propsKey = `${uuid}:${componentIndex}`;
  evalInPage(
    EVAL_GET_COMPONENT_PROPS(uuid, componentIndex),
    (result, err, raw, unchanged) => {
      if (selectedUuid !== uuid || selectedComponentIndex !== componentIndex) return;
      if (unchanged) return;
      lastComponentPropsRaw = typeof raw === "string" ? raw : "";
      lastComponentPropsKey = propsKey;
      if (err || !result?.ok) {
        componentProperties = [];
        componentPropertiesName = "";
        if (!silent) setToolStatus(result?.error || err || "Failed to load properties.", "error");
        const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
        if (node) requestDetailRender(node, { immediate: !silent, silent });
        return;
      }
      componentProperties = result.properties || [];
      componentPropertiesName = result.componentName || "Component";
      const node = hierarchy?.tree ? findNode(hierarchy.tree, uuid) : null;
      if (node) requestDetailRender(node, { immediate: !silent, silent });
    },
    { unchangedRaw: lastComponentPropsKey === propsKey ? lastComponentPropsRaw : "" }
  );
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
    resetBoneTreeState();
    return;
  }

  capturePropListScroll();

  detailEl.className = "detail";
  const comps = node.components
    .map((c, i) => {
      const isSpine = isSkeletonComponentName(c);
      const selected = selectedComponentIndex === i ? " selected" : "";
      const bonesOpen = boneTreeOpen && boneTreeUuid === node.uuid && boneTreeComponentIndex === i;
      const bonesBtn = isSpine
        ? `<button class="component-bones-btn${bonesOpen ? " active" : ""}" data-bones-index="${i}" type="button" title="Open skeleton bones tree">Bones</button>`
        : "";
      return `<span class="component-wrap"><button class="component${isSpine ? " spine" : ""}${selected}" data-component-index="${i}" type="button" title="Inspect properties and set as $c">${escapeHtml(c)}</button>${bonesBtn}</span>`;
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
    ${renderBoneTreeHtml()}
    ${renderComponentPropertiesHtml()}
  `;

  detailEl.querySelectorAll("[data-component-index]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(el.getAttribute("data-component-index"));
      selectedComponentIndex = index;
      componentProperties = [];
      componentPropertiesName = node.components[index] || "Component";
      componentPropListScrollTop = 0;
      scheduleRenderDetail(node, { immediate: true });
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

  detailEl.querySelectorAll("[data-bones-index]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(el.getAttribute("data-bones-index"));
      openBoneTree(node, index);
    });
  });

  bindBoneTree();
  bindBoneTreeResize();
  bindPropertyEditors(node);
  bindComponentPropListResize();
  bindNodePropListScroll();
  restorePropListScroll();
}

function bindComponentPropListResize() {
  const list = document.getElementById("component-prop-list");
  if (!list) return;

  // Restore user size without involving ResizeObserver (contentRect + border-box
  // caused the box to shrink on every auto-refresh re-render).
  if (componentPropListHeight) {
    list.style.height = `${componentPropListHeight}px`;
  }

  list.addEventListener("pointerdown", () => {
    componentPropListResizing = true;
    markDetailPointerActive();
  });
  list.addEventListener("scroll", () => {
    componentPropListScrollTop = list.scrollTop;
  }, { passive: true });
}

function bindBoneTreeResize() {
  const tree = document.getElementById("bone-tree");
  if (!tree) return;

  if (boneTreeHeight) {
    tree.style.height = `${boneTreeHeight}px`;
  }

  tree.addEventListener("pointerdown", () => {
    boneTreeResizing = true;
    markDetailPointerActive();
  });
  tree.addEventListener("scroll", () => {
    boneTreeScrollTop = tree.scrollTop;
  }, { passive: true });
}

function bindNodePropListScroll() {
  const list = document.getElementById("node-prop-list");
  if (!list) return;
  list.addEventListener("pointerdown", markDetailPointerActive);
  list.addEventListener("scroll", () => {
    nodePropListScrollTop = list.scrollTop;
  }, { passive: true });
}

function persistComponentPropListHeight() {
  if (!componentPropListResizing) return;
  componentPropListResizing = false;
  const list = document.getElementById("component-prop-list");
  if (!list) return;
  const height = Math.round(list.offsetHeight);
  if (height > 0) componentPropListHeight = height;
}

function persistBoneTreeHeight() {
  if (!boneTreeResizing) return;
  boneTreeResizing = false;
  const tree = document.getElementById("bone-tree");
  if (!tree) return;
  const height = Math.round(tree.offsetHeight);
  if (height > 0) boneTreeHeight = height;
}

if (!window.__animTracerPropListResizeBound) {
  window.__animTracerPropListResizeBound = true;
  window.addEventListener("pointerup", releaseDetailPointerLock);
  window.addEventListener("pointercancel", releaseDetailPointerLock);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function refreshSelectedNodeInspector(treeChanged) {
  if (!selectedUuid || !hierarchy?.tree) {
    updateSpineTraceToolVisibility(null);
    updateBreakNodeTargetLabel(null);
    return;
  }
  const node = findNode(hierarchy.tree, selectedUuid);
  if (!node) {
    selectedUuid = null;
    selectedComponentIndex = null;
    componentProperties = [];
    componentPropertiesName = "";
    nodeProperties = [];
    nodePropertiesStatus = "idle";
    nodePropertiesError = "";
    lastNodePropsRaw = "";
    lastNodePropsUuid = "";
    lastComponentPropsRaw = "";
    lastComponentPropsKey = "";
    updateSpineTraceToolVisibility(null);
    updateBreakNodeTargetLabel(null);
    return;
  }
  if (treeChanged) {
    updateSpineTraceToolVisibility(node);
    updateBreakNodeTargetLabel(node);
  }
  if (isDetailInteractionLocked()) {
    detailRefreshPending = true;
    return;
  }
  loadNodeProperties(node.uuid, { silent: true });
  if (selectedComponentIndex != null) {
    loadComponentProperties(node.uuid, selectedComponentIndex, { silent: true });
  } else if (treeChanged) {
    requestDetailRender(node, { silent: true });
  }
}

function finishRefresh() {
  refreshInFlight = false;
  if (refreshQueued) {
    refreshQueued = false;
    refresh();
  }
}

function refresh() {
  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;
  evalInPage(
    EVAL_GET_HIERARCHY,
    (result, err, raw, unchanged) => {
      try {
        if (unchanged && hierarchy?.ok) {
          refreshSelectedNodeInspector(false);
          return;
        }

        if (err) {
          lastHierarchyRaw = "";
          hierarchy = { ok: false, error: err };
          setStatus(err, "error");
          renderTree();
          return;
        }

        lastHierarchyRaw = typeof raw === "string" ? raw : "";
        hierarchy = result;
        if (!result?.ok) {
          setStatus(result?.error || "Cocos not ready", "error");
          renderTree();
          return;
        }

        setStatus(`${result.sceneName} · CC ${result.engineVersion}`, "ok");
        updateComponentFilterOptions();
        ensureExpandedForMarkedNode(hierarchy.tree);
        refreshSelectedNodeInspector(true);
        renderTree();
      } finally {
        finishRefresh();
      }
    },
    { unchangedRaw: lastHierarchyRaw }
  );
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
addNodeBreakBtn.addEventListener("click", registerNodeBreakFromUI);
clearNodeBreaksBtn.addEventListener("click", clearNodeBreaksFromUI);
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
initToolFeatureSettings();
initToolsPanelResizer();
loadMarkedNodes();
setBuildNote();
syncGameSpeedFromPage();
syncPauseStateFromPage();
updateSpineTraceToolVisibility(null);
updateBreakNodeTargetLabel(null);
refreshNodeBreakList();
refresh();
startAutoRefresh();
