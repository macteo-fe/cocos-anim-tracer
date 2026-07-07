const treeEl = document.getElementById("tree");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const componentFilterEl = document.getElementById("component-filter");
const clearFiltersBtn = document.getElementById("btn-clear-filters");
const expandAllBtn = document.getElementById("btn-expand-all");
const collapseAllBtn = document.getElementById("btn-collapse-all");
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

const EVAL_GET_HIERARCHY = `(() => {
  if (!window.__cocosHierarchyBridge__) return { ok: false, error: "Bridge not injected" };
  return window.__cocosHierarchyBridge__.getHierarchy();
})()`;

const EVAL_SELECT = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.selectNode(${JSON.stringify(uuid)}) ?? false;
})()`;

const EVAL_TOGGLE = (uuid) => `(() => {
  return window.__cocosHierarchyBridge__?.toggleActive(${JSON.stringify(uuid)}) ?? false;
})()`;

function evalInPage(expression, callback) {
  chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
    if (exceptionInfo?.isException) {
      callback(null, exceptionInfo.value?.description || "Eval error");
      return;
    }
    callback(result, null);
  });
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
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
  if (!node.activeInHierarchy) row.classList.add("inactive");
  if (node.isSpine) row.classList.add("spine");
  if (isSelected) row.classList.add("selected");
  if (isDirectMatch) row.classList.add("filter-match");
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
  selectedUuid = node.uuid;
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
    .map((c) => {
      const isSpine = /spine|skeleton/i.test(c);
      return `<span class="component${isSpine ? " spine" : ""}">${escapeHtml(c)}</span>`;
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
      if (node) renderDetail(node);
      else selectedUuid = null;
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
refresh();
startAutoRefresh();
