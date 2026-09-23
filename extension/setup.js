/**
 * Markup Bridge Extension Setup Page Script
 * Manages live connection health checking and user preferences.
 */

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const btnRecheck = document.getElementById('btn-recheck');
const prefPort = document.getElementById('pref-port');
const prefShowPill = document.getElementById('pref-show-pill');

// 1. Connection Health Check
async function checkBridgeHealth() {
  const port = prefPort.value || 3005;
  const endpoint = `http://127.0.0.1:${port}/health`;

  statusDot.className = 'dot';
  statusText.textContent = `Pinging http://127.0.0.1:${port}...`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    statusDot.className = 'dot online';
    statusText.textContent = `Connected (Uptime: ${Math.round(data.uptime)}s)`;
  } catch (_) {
    statusDot.className = 'dot offline';
    statusText.textContent = `Offline. Run 'npx markup-bridge@latest'`;
  }
}

btnRecheck.addEventListener('click', checkBridgeHealth);

// 2. Copy Code Handlers
const setupCopy = (btnId, cmdId) => {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const text = document.getElementById(cmdId).textContent;
    navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy'), 2000);
  });
};

setupCopy('btn-copy-start', 'cmd-start');
setupCopy('btn-copy-markup', 'cmd-markup');
setupCopy('btn-copy-restart', 'cmd-restart');
setupCopy('btn-copy-remove', 'cmd-remove');

// 3. Preferences Storage
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.sync.get(['showPill', 'bridgePort'], (data) => {
    if (data.showPill !== undefined) prefShowPill.checked = data.showPill;
    if (data.bridgePort) prefPort.value = data.bridgePort;
    checkBridgeHealth();
  });

  prefShowPill.addEventListener('change', () => {
    chrome.storage.sync.set({ showPill: prefShowPill.checked });
  });

  prefPort.addEventListener('change', () => {
    const port = parseInt(prefPort.value, 10) || 3005;
    chrome.runtime.sendMessage({ action: 'portChanged', port }, () => {
      checkBridgeHealth();
    });
  });
} else {
  checkBridgeHealth();
}
