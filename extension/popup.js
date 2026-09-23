const dot = document.getElementById('dot');
const statusLabel = document.getElementById('status-label');
const statusPort = document.getElementById('status-port');

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
      if (chrome.runtime.lastError) {
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
