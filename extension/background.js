/**
 * Markup Bridge - Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *   - Register context menu on install
 *   - Periodically probe the local bridge daemon (health check)
 *   - Display badge to indicate connection status
 *   - Route messages from popup / content scripts
 *   - Inject client into tabs on demand (context menu / popup toggle)
 */

const DEFAULT_PORT = 3005;
let cachedPort = DEFAULT_PORT;
let bridgeOnline = false;

// ── Restore port from storage when service worker wakes up
chrome.storage.sync.get({ bridgePort: DEFAULT_PORT }, (prefs) => {
  cachedPort = Number(prefs.bridgePort) || DEFAULT_PORT;
  probeBridge();
});

// ── Register context menu on install/update
// NOTE: contextMenus.create must only be called here (inside onInstalled),
// not at top-level — calling it at top-level on service worker restart
// throws "Cannot create item with duplicate ID" and crashes the worker.
chrome.runtime.onInstalled.addListener(() => {
  // Clear any previously registered items first to avoid duplicate ID errors
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'markup-bridge-toggle',
      title: 'Inspect with Markup Bridge (Alt + Shift + X)',
      contexts: ['all']
    });
  });
  probeBridge();
});

// ── Health probe function
async function probeBridge() {
  const port = cachedPort;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: ctrl.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      bridgeOnline = true;
      const pending = data.pendingCount || 0;
      chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
      chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : '' });
      chrome.action.setTitle({ title: `Markup Bridge — Connected (port ${port})` });
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (_) {
    bridgeOnline = false;
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Markup Bridge — Daemon Offline (run: npx markup-bridge)' });
  }
}

// ── Periodic health probe via alarms (MV3 compatible, survives service worker sleep)
// Uses alarms API instead of setInterval — setInterval is killed when the SW sleeps.
// Requires "alarms" permission in manifest.json.
chrome.alarms.create('probeBridge', { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'probeBridge') {
    probeBridge();
  }
});

// ── Context menu click → toggle bridge on tab
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'markup-bridge-toggle' && tab && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggleBridge' });
    } catch (_) {
      // Content script not injected yet — inject it first, then toggle
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js', 'client.bundle.js']
        });
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: 'toggleBridge' }).catch(() => {});
        }, 150);
      } catch (err) {
        console.warn('[MarkupBridge] Injection failed from context menu:', err);
      }
    }
  }
});

// ── Message router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Popup asking for bridge status
  if (msg.action === 'getBridgeStatus') {
    const port = cachedPort;
    fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(data => sendResponse({ online: true, port, pendingCount: data.pendingCount || 0 }))
      .catch(() => sendResponse({ online: false, port, pendingCount: 0 }));
    return true; // keep channel open for async response
  }

  // Port changed in setup page
  if (msg.action === 'portChanged') {
    cachedPort = Number(msg.port) || DEFAULT_PORT;
    chrome.storage.sync.set({ bridgePort: cachedPort });
    probeBridge();
    sendResponse({ ok: true });
    return true;
  }

  // Popup requesting to inject bridge into current tab
  if (msg.action === 'injectCurrentTab' && msg.tabId) {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      files: ['content.js', 'client.bundle.js']
    }).then(() => {
      setTimeout(() => {
        chrome.tabs.sendMessage(msg.tabId, { action: 'toggleBridge' }).catch(() => {});
      }, 150);
    }).catch(err => console.warn('[MarkupBridge] Injection failed:', err));
    sendResponse({ ok: true });
    return true;
  }

  return true;
});

// ── Storage change listener (port updated in setup page)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.bridgePort) {
    cachedPort = Number(changes.bridgePort.newValue) || DEFAULT_PORT;
    probeBridge();
  }
});
