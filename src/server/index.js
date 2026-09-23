import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedbackQueue } from './queue.js';
import { SSEManager } from './sse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

export function createBridgeServer({
  port = 3005,
  host = '127.0.0.1',
  storageDir = path.resolve(process.cwd(), '.antigravity'),
  silent = false
} = {}) {
  const queue = new FeedbackQueue(storageDir);
  const sse = new SSEManager();

  // Forward queue events to SSE
  queue.subscribe((event, data) => {
    if (event === 'created') {
      sse.broadcast('feedback_created', data);
    } else if (event === 'updated' && data.status === 'resolved') {
      sse.broadcast('feedback_resolved', data);
    } else if (event === 'updated') {
      sse.broadcast('feedback_updated', data);
    } else if (event === 'deleted') {
      sse.broadcast('feedback_deleted', data);
    } else if (event === 'cleared') {
      sse.broadcast('feedback_cleared', data);
    }
  });

  const server = http.createServer(async (req, res) => {
    // Permissive CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1:3005'}`);
    const pathname = parsedUrl.pathname;

    try {
      // 1. Client Script
      if (req.method === 'GET' && pathname === '/client.js') {
        const clientPath = path.resolve(__dirname, '../client/client.js');
        if (fs.existsSync(clientPath)) {
          const content = fs.readFileSync(clientPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache'
          });
          res.end(content);
          return;
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('client.js not found');
          return;
        }
      }

      // 2. Server-Sent Events (SSE)
      if (req.method === 'GET' && pathname === '/api/events') {
        sse.addClient(res);
        return;
      }

      // 3. Health & Status
      if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          uptime: process.uptime(),
          pendingCount: queue.listFeedback({ status: 'pending' }).length,
          totalCount: queue.items.length,
          sseClients: sse.getClientCount()
        });
        return;
      }

      // 4. Feedback Endpoints
      // POST /api/feedback
      if (req.method === 'POST' && pathname === '/api/feedback') {
        const body = await parseJsonBody(req);
        if (!body) {
          sendJson(res, 400, { error: 'Invalid JSON body' });
          return;
        }

        const feedback = queue.addFeedback(body);
        console.log(`📥 [MarkupBridge] Feedback received: ${feedback.selector} - "${feedback.userNotes}" (#${feedback.id.slice(-6)})`);
        sendJson(res, 201, feedback);
        return;
      }

      // GET /api/feedback/latest
      if (req.method === 'GET' && pathname === '/api/feedback/latest') {
        const latest = queue.getLatestPending();
        sendJson(res, 200, { latest });
        return;
      }

      // GET /api/feedback
      if (req.method === 'GET' && pathname === '/api/feedback') {
        const status = parsedUrl.searchParams.get('status') || 'all';
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const items = queue.listFeedback({ status, limit });
        sendJson(res, 200, { items, count: items.length });
        return;
      }

      // Feedback by ID: /api/feedback/:id
      const idMatch = pathname.match(/^\/api\/feedback\/([^/]+)$/);
      if (idMatch) {
        const id = idMatch[1];

        // GET /api/feedback/:id
        if (req.method === 'GET') {
          const item = queue.getFeedback(id);
          if (!item) {
            sendJson(res, 404, { error: `Feedback item ${id} not found` });
          } else {
            sendJson(res, 200, item);
          }
          return;
        }

        // PATCH /api/feedback/:id
        if (req.method === 'PATCH') {
          const updates = await parseJsonBody(req);
          const updated = queue.updateFeedback(id, updates || {});
          if (!updated) {
            sendJson(res, 404, { error: `Feedback item ${id} not found` });
          } else {
            console.log(`✅ [MarkupBridge] Feedback ${id} updated: status=${updated.status} ("${updated.resolutionNotes || ''}")`);
            sendJson(res, 200, updated);
          }
          return;
        }

        // DELETE /api/feedback/:id
        if (req.method === 'DELETE') {
          const success = queue.deleteFeedback(id);
          if (!success) {
            sendJson(res, 404, { error: `Feedback item ${id} not found` });
          } else {
            sendJson(res, 200, { success: true, deletedId: id });
          }
          return;
        }
      }

      // POST /api/feedback/clear
      if (req.method === 'POST' && pathname === '/api/feedback/clear') {
        const body = await parseJsonBody(req);
        const status = body?.status || 'all';
        queue.clearQueue({ status });
        sendJson(res, 200, { success: true, statusCleared: status });
        return;
      }

      // 5. Interactive Demo App
      if (req.method === 'GET' && (pathname === '/demo' || pathname === '/demo/')) {
        const demoPath = path.resolve(__dirname, '../demo/index.html');
        if (fs.existsSync(demoPath)) {
          const content = fs.readFileSync(demoPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
          return;
        }
      }

      // 5.5 Extension Setup Page & Download
      if (req.method === 'GET' && (pathname === '/setup' || pathname === '/setup.html')) {
        const setupPath = path.resolve(ROOT_DIR, 'extension/setup.html');
        if (fs.existsSync(setupPath)) {
          const content = fs.readFileSync(setupPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
          return;
        }
      }

      if (req.method === 'GET' && pathname === '/setup.js') {
        const setupJsPath = path.resolve(ROOT_DIR, 'extension/setup.js');
        if (fs.existsSync(setupJsPath)) {
          const content = fs.readFileSync(setupJsPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(content);
          return;
        }
      }

      if (req.method === 'GET' && (pathname === '/download/extension.zip' || pathname === '/extension.zip')) {
        const zipPath = path.resolve(ROOT_DIR, 'markup-bridge-extension.zip');
        if (fs.existsSync(zipPath)) {
          const stat = fs.statSync(zipPath);
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="markup-bridge-extension.zip"',
            'Content-Length': stat.size
          });
          fs.createReadStream(zipPath).pipe(res);
          return;
        }
      }

      // 6. Developer Dashboard / Status UI
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderDashboardHtml({ port, host, queue, sse }));
        return;
      }

      // 404 Fallback
      sendJson(res, 404, { error: 'Not Found', path: pathname });
    } catch (err) {
      if (!silent) console.error('[MarkupBridge] Server error:', err);
      sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
    }
  });

  return {
    server,
    queue,
    sse,
    start: () =>
      new Promise((resolve, reject) => {
        server.listen(port, host, () => {
          if (!silent) {
            console.log(`\n[MarkupBridge] Daemon active and listening on port ${port}`);
            console.log(`[MarkupBridge] Feedback sync enabled for: ${queue.storageFile}`);
            console.log(`[MarkupBridge] Press Ctrl+C to shut down.\n`);
          }
          resolve({ port, host, url: `http://${host}:${port}` });
        });
        server.on('error', reject);
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
      })
  };
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy(); // Prevent flood
        resolve(null);
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

function renderDashboardHtml({ port, host, queue, sse }) {
  const pending = queue.listFeedback({ status: 'pending' });
  const resolved = queue.listFeedback({ status: 'resolved' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markup Bridge for Antigravity</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --border: #1f2937;
      --accent: #6366f1;
      --text: #f3f4f6;
      --muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 40px 20px;
      line-height: 1.5;
    }
    .container { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 24px;
    }
    h1 { font-size: 24px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
    .badge-live {
      background: #065f46; color: #34d399; font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: 9999px; text-transform: uppercase;
    }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .stat-card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 12px; padding: 20px;
    }
    .stat-val { font-size: 32px; font-weight: 800; color: #fff; margin-top: 4px; }
    .stat-lbl { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 16px;
    }
    .code-box {
      background: #030712; border: 1px solid #1f2937; border-radius: 8px;
      padding: 12px 16px; font-family: monospace; font-size: 13px; color: #38bdf8;
      overflow-x: auto;
    }
    .btn-link {
      display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
      font-weight: 600; padding: 8px 16px; border-radius: 8px; align-self: flex-start;
      transition: background 0.2s;
    }
    .btn-link:hover { background: #4f46e5; }
    .table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .table th, .table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    .table th { color: var(--muted); font-weight: 600; }
    .tag-badge { background: #374151; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
    .status-badge { padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .status-pending { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .status-resolved { background: rgba(16, 185, 129, 0.2); color: #34d399; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>✨ Markup Bridge for Antigravity</h1>
        <p style="color: var(--muted); font-size: 14px; margin-top: 4px;">
          Local bridge running on <code>http://${host}:${port}</code>
        </p>
      </div>
      <div>
        <span class="badge-live">● System Active</span>
      </div>
    </header>

    <div class="grid">
      <div class="stat-card">
        <div class="stat-lbl">Pending Feedback</div>
        <div class="stat-val" style="color: #fbbf24;">${pending.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">Resolved by Agent</div>
        <div class="stat-val" style="color: #34d399;">${resolved.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">SSE Connections</div>
        <div class="stat-val" style="color: #818cf8;">${sse.getClientCount()}</div>
      </div>
    </div>

    <div class="card">
      <h2>🔌 Universal Integration Hub (Any Project, Any Framework)</h2>
      <p style="color: var(--muted); font-size: 14px;">
        Choose the integration method that best fits your workflow:
      </p>

      <!-- Bookmarklet -->
      <div style="background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 10px; padding: 16px; margin-top: 8px;">
        <h3 style="font-size: 14px; margin-bottom: 6px; color: #a5b4fc;">⭐ 1-Click Bookmarklet (Works on ANY browser tab without installing anything!)</h3>
        <p style="color: var(--muted); font-size: 12px; margin-bottom: 12px;">
          Drag this button to your Bookmarks Bar. Click it on any tab (localhost, Vercel preview, staging) to activate Markup Bridge:
        </p>
        <a class="btn-link" style="cursor: grab; display: inline-flex; align-items: center; gap: 6px;"
           href="javascript:(function(){if(window.__ANTIGRAVITY_BRIDGE_INITIALIZED__)return;const s=document.createElement('script');s.src='http://${host}:${port}/client.js';document.head.appendChild(s);})();"
           onclick="alert('Drag this button to your bookmarks bar! Then click it on any website.'); return false;">
          <span>📌 Markup Bridge Bookmarklet</span>
        </a>
      </div>

      <!-- Script Tag -->
      <div style="margin-top: 12px;">
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">Option A: Drop-in &lt;script&gt; Tag</div>
        <div class="code-box">&lt;script src="http://${host}:${port}/client.js"&gt;&lt;/script&gt;</div>
      </div>

      <!-- Vite / Next.js -->
      <div style="margin-top: 12px;">
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">Option B: Vite Plugin (React / Vue / Svelte)</div>
        <div class="code-box">// vite.config.ts&#10;import { markupBridge } from 'markup-by-kabya/vite';&#10;export default defineConfig({ plugins: [react(), markupBridge()] });</div>
      </div>

      <!-- Chrome Extension -->
      <div style="margin-top: 12px;">
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">Option C: Chrome Extension (Manifest V3)</div>
        <p style="color: var(--muted); font-size: 12px;">Load the <code>extension/</code> folder in Chrome (<code>chrome://extensions</code> -> Load unpacked) to activate on any tab with 1 click.</p>
      </div>

      <div style="display: flex; gap: 12px; margin-top: 16px;">
        <a class="btn-link" href="/demo" target="_blank">Launch Interactive Demo App ↗</a>
        <a class="btn-link" style="background:#374151;" href="/api/feedback" target="_blank">View JSON Queue ↗</a>
      </div>
    </div>

    <div class="card">
      <h2>📋 Recent Feedback Queue</h2>
      ${queue.items.length === 0 ? `
        <p style="color: var(--muted); font-size: 13px;">No feedback items submitted yet. Open the demo app and press <strong>Alt + Shift + X</strong> or click the bottom-right pill widget to inspect an element!</p>
      ` : `
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Component / Selector</th>
              <th>Notes</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${queue.items.slice(0, 10).map(item => `
              <tr>
                <td><code>#${item.id.slice(-6)}</code></td>
                <td><span class="status-badge status-${item.status}">${item.status}</span></td>
                <td>
                  <strong>${item.reactContext?.componentName || ''}</strong>
                  <div style="color: var(--muted); font-family: monospace; font-size: 11px;">${item.selector}</div>
                </td>
                <td>${item.userNotes || '—'}</td>
                <td style="color: var(--muted); font-size: 11px;">${new Date(item.timestamp).toLocaleTimeString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  </div>
</body>
</html>`;
}
