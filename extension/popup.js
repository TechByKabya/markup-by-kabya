const dot = document.getElementById('dot');
const statusLabel = document.getElementById('status-label');
const statusPort = document.getElementById('status-port');
const chkEnable = document.getElementById('chk-master-enable');
const btnActivate = document.getElementById('btn-activate');

// Load initial state
chrome.storage.sync.get({ extensionEnabled: true }, (prefs) => {
  chkEnable.checked = prefs.extensionEnabled;
  if (!prefs.extensionEnabled) {
    btnActivate.disabled = true;
    btnActivate.style.opacity = '0.5';
  }
});

// Handle toggle changes
chkEnable.addEventListener('change', (e) => {
  const isEnabled = e.target.checked;
  chrome.storage.sync.set({ extensionEnabled: isEnabled }, () => {
    btnActivate.disabled = !isEnabled;
    btnActivate.style.opacity = isEnabled ? '1' : '0.5';
    
    // Notify all tabs to reload or update state if possible
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'refreshPreferences' }).catch(() => {}));
    });
  });
});

chrome.runtime.sendMessage({ action: 'getBridgeStatus' }, (res) => {
  if (chrome.runtime.lastError || !res) {
    dot.className = 'dot offline';
    statusLabel.textContent = 'Extension Error';
    return;
  }
  
  statusPort.textContent = `127.0.0.1:${res.port}`;
  if (res.online) {
    dot.className = 'dot online';
    statusLabel.textContent = `Connected (${res.pendingCount || 0} queued)`;
  } else {
    dot.className = 'dot offline';
    statusLabel.textContent = 'Daemon Offline';
  }
});

document.getElementById('btn-activate').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggleBridge' }, (res) => {
      if (chrome.runtime.lastError || (res && res.status === 'not_found')) {
        chrome.runtime.sendMessage({ action: 'injectCurrentTab', tabId: tab.id });
      }
      window.close();
    });
  }
});

document.getElementById('btn-setup').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('setup.html'));
  }
});
