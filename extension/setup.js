/**
 * Markup Bridge Extension Setup Page Script
 * Manages live connection health checking and user preferences.
 */

const statusDot = document.getElementById('status-dot');
const statusTitle = document.getElementById('status-title');
const statusDesc = document.getElementById('status-desc');
const btnRecheck = document.getElementById('btn-recheck');
const prefPort = document.getElementById('pref-port');
const prefShowPill = document.getElementById('pref-show-pill');

// 1. Connection Health Check
async function checkBridgeHealth() {
  const port = prefPort.value || 3005;
  const endpoint = `http://127.0.0.1:${port}/health`;

  statusDot.className = 'status-indicator';
  statusTitle.textContent = 'Checking Local Bridge Server...';
  statusDesc.textContent = `Pinging ${endpoint}`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    statusDot.className = 'status-indicator online';
    statusTitle.textContent = 'Local Bridge Server Connected';
    statusDesc.textContent = `Active on port ${port} • Uptime: ${Math.round(data.uptime)}s • ${data.pendingCount || 0} pending items`;
  } catch (_) {
    statusDot.className = 'status-indicator offline';
    statusTitle.textContent = 'Bridge Server Not Detected';
    statusDesc.textContent = `Ensure 'npx markup-bridge server' is running in your terminal.`;
  }
}

btnRecheck.addEventListener('click', checkBridgeHealth);

// 2. Copy Code Handlers
document.getElementById('btn-copy-mcp').addEventListener('click', (e) => {
  const text = document.getElementById('code-mcp').textContent;
  navigator.clipboard.writeText(text);
  e.target.textContent = 'Copied';
  setTimeout(() => (e.target.textContent = 'Copy'), 2000);
});

document.getElementById('btn-copy-cmd').addEventListener('click', (e) => {
  const text = document.getElementById('code-cmd').textContent;
  navigator.clipboard.writeText(text);
  e.target.textContent = 'Copied';
  setTimeout(() => (e.target.textContent = 'Copy'), 2000);
});

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
