/**
 * Markup Bridge Extension - Content Script
 *
 * Runs on every tab matched by manifest.json.
 * Responsibilities:
 *   1. Read user preferences (port, showPill) from chrome.storage.sync
 *   2. Expose port to client.bundle.js via window.__MARKUP_BRIDGE_PORT__
 *   3. Apply pill visibility preference after the client initialises
 *   4. Route toggle / refresh messages from the popup / background
 */

(function () {
  if (window.__ANTIGRAVITY_CONTENT_ROUTER_ACTIVE__) return;
  window.__ANTIGRAVITY_CONTENT_ROUTER_ACTIVE__ = true;

  // ── 1. Inject port before client.bundle.js (which runs immediately after this)
  //       chrome.storage is async, so we do a best-effort sync read via the
  //       background's cached value; if unavailable, the bundle falls back to 3005.
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ bridgePort: 3005, showPill: true, extensionEnabled: true }, function (prefs) {
      if (!prefs.extensionEnabled) {
        return; // Master kill switch activated
      }

      window.__MARKUP_BRIDGE_PORT__ = Number(prefs.bridgePort) || 3005;

      if (typeof window.__INIT_MARKUP_BRIDGE__ === 'function') {
        window.__INIT_MARKUP_BRIDGE__();
      }

      setTimeout(() => applyPillVisibility(prefs.showPill), 300);
    });
  } else {
    window.__MARKUP_BRIDGE_PORT__ = 3005;
  }

  // ── 2. Apply pill visibility
  function applyPillVisibility(showPill) {
    const host = document.getElementById('antigravity-bridge-host');
    if (!host || !host.shadowRoot) return;
    const pill = host.shadowRoot.getElementById('ag-pill');
    if (!pill) return;
    pill.style.display = (showPill === false) ? 'none' : 'flex';
  }

  // ── 3. Message handler (from popup button & context menu)
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'toggleBridge') {
      if (typeof window.__ANTIGRAVITY_TOGGLE === 'function') {
        window.__ANTIGRAVITY_TOGGLE();
        sendResponse({ status: 'toggled' });
      } else {
        sendResponse({ status: 'not_found' });
      }

    } else if (request.action === 'refreshPreferences') {
      chrome.storage.sync.get({ bridgePort: 3005, showPill: true, extensionEnabled: true }, function (prefs) {
        window.__MARKUP_BRIDGE_PORT__ = Number(prefs.bridgePort) || 3005;
        
        if (!prefs.extensionEnabled) {
          // Master kill switch activated: remove UI entirely
          const host = document.getElementById('antigravity-bridge-host');
          if (host) host.remove();
          window.__ANTIGRAVITY_BRIDGE_INITIALIZED__ = false;
        } else {
          // Re-init if it was previously killed
          if (typeof window.__INIT_MARKUP_BRIDGE__ === 'function') {
            window.__INIT_MARKUP_BRIDGE__();
          }
        }

        applyPillVisibility(prefs.showPill);
        sendResponse({ status: 'refreshed' });
      });
      return true; // keep channel open for async

    } else if (request.action === 'getBridgeStatus') {
      const port = window.__MARKUP_BRIDGE_PORT__ || 3005;
      const host = document.getElementById('antigravity-bridge-host');
      sendResponse({
        port,
        clientReady: !!host,
        url: `http://127.0.0.1:${port}`
      });
    }

    return true;
  });
})();
