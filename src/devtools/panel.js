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
const TOOLS_MIN_WIDTH = 260;
const TOOLS_MAX_WIDTH = 700;
const THEME_STORAGE_KEY = "animtracer-theme-preference";

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

const EVAL_TOGGLE = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.toggleActive(${JSON.stringify(uuid)}) ?? false;
})()`;

const EVAL_FIND_REFS = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.findNodeReferences(${JSON.stringify(uuid)}) ?? { ok: false, error: "Bridge not injected" };
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
    btn.innerHTML = `
      <span class="reference-item-title">${escapeHtml(hit.hierarchyPath || hit.nodeName || hit.nodeUuid)}</span>
      <span class="reference-item-meta">${escapeHtml(hit.componentName || "Component")} • ${escapeHtml(hit.nodeUuid || "")}</span>
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
    selectedUuid = nodeUuid;
    refUuidInputEl.value = nodeUuid;
    updateSpineTraceToolVisibility(node);
    evalInPage(EVAL_SELECT(nodeUuid), () => {});
    renderDetail(node);
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
  }
  updateSpineTraceToolVisibility(node);
  evalInPage(EVAL_SELECT(node.uuid), () => {});
  renderDetail(node);
  renderTree();
}

function renderDetail(node) {
  if (!node) {
    detailEl.className = "detail empty";
    detailEl.textContent = "Select a node";
    return;
  }

  detailEl.className = "detail";
  const pos = node.position;
  const comps = node.components
    .map((c, i) => {
      const isSpine = /spine|skeleton/i.test(c);
      return `<button class="component${isSpine ? " spine" : ""}" data-component-index="${i}" type="button" title="Set as $c in console">${escapeHtml(c)}</button>`;
    })
    .join("");

  detailEl.innerHTML = `
    <table>
      <tr><th>Name</th><td>${escapeHtml(node.name)}</td></tr>
      <tr><th>UUID</th><td style="font-family:var(--mono);font-size:10px;word-break:break-all">${escapeHtml(node.uuid)}</td></tr>
      <tr><th>Active</th><td>${node.active ? "Yes" : "No"}</td></tr>
      <tr><th>In Hierarchy</th><td>${node.activeInHierarchy ? "Yes" : "No"}</td></tr>
      <tr><th>Position</th><td>${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}</td></tr>
      <tr><th>Children</th><td>${node.childCount}</td></tr>
      <tr><th>Layer</th><td>${node.layer}</td></tr>
    </table>
    <div class="components">
      <h2>Components</h2>
      ${comps || '<span style="color:var(--text-dim)">None</span>'}
    </div>
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
      evalInPage(EVAL_SELECT_COMPONENT(node.uuid, index), (ok) => {
        if (ok) {
          setToolStatus(`Selected component set to $c (${node.components[index] || "Component"})`, "ok");
        } else {
          setToolStatus("Failed to select component.", "error");
        }
      });
    });
  });
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
        renderDetail(node);
      } else {
        selectedUuid = null;
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
initToolsPanelResizer();
setBuildNote();
syncGameSpeedFromPage();
syncPauseStateFromPage();
updateSpineTraceToolVisibility(null);
refresh();
startAutoRefresh();
