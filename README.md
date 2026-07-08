# AnimTracer (Chrome DevTools Extension)

AnimTracer is a Chrome DevTools extension for inspecting the runtime hierarchy of Cocos Creator games.

It adds a custom DevTools tab named `AnimTracer` and shows:

- Scene node tree
- Node details (name, UUID, position, active state, components)
- Filters by node name and component
- Expand/collapse controls for hierarchy navigation

## Features

- Live Cocos scene hierarchy view
- Filter by node name
- Filter by component (dropdown with counts)
- Expand all / Collapse all
- Toggle node active state
- Highlight Spine/Skeleton nodes
- Select node and inspect from DevTools panel

## Requirements

- Google Chrome (or Chromium-based browser with Chrome extension support)
- Cocos Creator game running in a browser page (with `window.cc` available)

## Install (Load Unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder (`spine-tracer`)

## How to Use

1. Open your Cocos game page in Chrome.
2. Open Chrome DevTools.
3. Go to the `AnimTracer` tab.
4. Use the tree to browse nodes:
   - Single click row: select node
   - Click arrow/folder icon: expand/collapse
   - Double-click node name: expand/collapse
5. Use filters:
   - Search input for node name
   - Component dropdown for component-based filtering

## Project Structure

- `manifest.json` - Extension manifest (MV3)
- `src/content.js` - Injects bridge into page and forwards events
- `src/inject.js` - Runs in page context, reads Cocos runtime hierarchy
- `src/background.js` - Relays messages between content script and DevTools panel
- `src/devtools/devtools.html` - DevTools entry page
- `src/devtools/devtools.js` - Registers `AnimTracer` panel
- `src/devtools/panel.html` - Panel markup
- `src/devtools/panel.css` - Panel styles
- `src/devtools/panel.js` - Tree rendering, filtering, interactions
- `icons/` - Extension icons

## Notes

- If the panel does not show data, reload the page after loading/reloading the extension.
- If DevTools tab changes do not appear, close and reopen DevTools.
