import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedbackQueue } from '../server/queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage dir resolution priority:
//   1. MARKUP_BRIDGE_STORAGE env var (explicit, cross-project safe)
//   2. CWD/.antigravity (default, works when CWD = project root)
const STORAGE_DIR = process.env.MARKUP_BRIDGE_STORAGE
  || path.resolve(process.cwd(), '.antigravity');

const BRIDGE_API_BASE = process.env.BRIDGE_API_BASE || 'http://127.0.0.1:3005';

export function createMcpServer({
  storageDir = STORAGE_DIR
} = {}) {
  const queue = new FeedbackQueue(storageDir);

  const server = new McpServer({
    name: 'antigravity-ui-bridge',
    version: '2.0.0'
  });

  // Helper: sync update with running HTTP bridge server for SSE broadcast
  async function notifyBridgeServer(id, updates) {
    try {
      const res = await fetch(`${BRIDGE_API_BASE}/api/feedback/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {
      // Bridge server might not be running; fallback to direct queue update
    }
    return queue.updateFeedback(id, updates);
  }

  // Helper: fetch from bridge server with queue fallback
  async function fetchFeedback(id) {
    try {
      const res = await fetch(`${BRIDGE_API_BASE}/api/feedback/${encodeURIComponent(id)}`);
      if (res.ok) return await res.json();
    } catch (_) {}
    queue.init();
    return queue.getFeedback(id);
  }

  async function fetchFeedbackList({ status, limit }) {
    try {
      const res = await fetch(`${BRIDGE_API_BASE}/api/feedback?status=${encodeURIComponent(status)}&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        return data.items || [];
      }
    } catch (_) {}
    queue.init();
    return queue.listFeedback({ status, limit });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool 1: get_action_command — NEW lightweight tool
  //
  // Returns pre-digested action command strings for pending feedback.
  // Use this FIRST before get_ui_feedback — it gives everything needed for
  // simple style/copy/layout changes in a single compact call.
  // ─────────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_action_command',
    {
      limit: z
        .number()
        .optional()
        .describe('Max number of pending items to return. Defaults to 5.')
    },
    async ({ limit = 5 }) => {
      let commands = [];

      try {
        const res = await fetch(`${BRIDGE_API_BASE}/api/feedback/action-queue?fresh=false&limit=${limit}`);
        if (res.ok) {
          const data = await res.json();
          commands = data.commands || [];
        }
      } catch (_) {}

      if (commands.length === 0) {
        queue.init();
        const pending = queue.listFeedback({ status: 'pending', limit });
        commands = pending.map(item => ({
          id: item.id,
          timestamp: item.timestamp,
          actionCommand: item.actionCommand || queue.generateActionCommand(item)
        }));
      }

      if (commands.length === 0) {
        return {
          content: [{ type: 'text', text: 'No pending UI feedback items in queue.' }]
        };
      }

      const text = commands.map((c, i) =>
        `### Action [${i + 1}] — ID: \`${c.id}\`\n${c.actionCommand}`
      ).join('\n\n---\n\n');

      return {
        content: [{
          type: 'text',
          text: `${commands.length} pending UI change(s) to execute:\n\n${text}`
        }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool 2: list_ui_feedback
  // ─────────────────────────────────────────────────────────────────────────────
  server.tool(
    'list_ui_feedback',
    {
      status: z
        .enum(['pending', 'resolved', 'dismissed', 'all'])
        .optional()
        .describe("Filter feedback items by status. Defaults to 'pending'."),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of items to return. Defaults to 20.')
    },
    async ({ status = 'pending', limit = 20 }) => {
      const items = await fetchFeedbackList({ status, limit });

      if (items.length === 0) {
        return {
          content: [{ type: 'text', text: `No UI feedback items found with status="${status}".` }]
        };
      }

      const formatted = items.map((item, idx) => {
        const comp = item.reactContext?.componentName || 'DOM Element';
        let src = item.reactContext?.source
          ? ` (${item.reactContext.source.file}:${item.reactContext.source.line})`
          : '';
        if (!src && item.url && item.url.startsWith('file://')) {
          try { src = ` (${new URL(item.url).pathname})`; } catch (_) {}
        }
        // Include pre-digested action command for quick scanning
        const cmd = item.actionCommand ? `\n**Quick Action**: ${item.actionCommand.split('\n')[0]}` : '';
        return `### [${idx + 1}] Feedback ID: \`${item.id}\`
- **Status**: ${item.status.toUpperCase()} (${item.tag || 'general'})
- **Target**: \`${comp}\`${src}
- **CSS Selector**: \`${item.selector}\`
- **User Notes**: ${item.userNotes || 'No notes provided'}
- **Created**: ${item.timestamp}${cmd}`;
      }).join('\n\n---\n\n');

      return {
        content: [{ type: 'text', text: `Found ${items.length} feedback item(s):\n\n${formatted}` }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool 3: get_ui_feedback — enriched with opt-in computed styles
  //
  // IMPORTANT CHANGE: computed styles are now OPTIONAL (opt-in via includeStyles).
  // This eliminates the 800-token CSS property dump for simple changes.
  // Only request includeStyles: true when you genuinely need to inspect layout/color.
  // ─────────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_ui_feedback',
    {
      id: z.string().describe('The feedback ID (e.g. fb_1774330623123_a8b9)'),
      includeStyles: z
        .boolean()
        .optional()
        .describe('Set true to include computed CSS styles table. Omit for simple changes — saves tokens.')
    },
    async ({ id, includeStyles = false }) => {
      const item = await fetchFeedback(id);

      if (!item) {
        return {
          content: [{ type: 'text', text: `Error: UI feedback item with ID "${id}" was not found.` }]
        };
      }

      // Start with the pre-digested action command (always included)
      let details = `# UI Feedback: ${item.id}\n\n`;
      details += `## ⚡ Action Command (Pre-Digested)\n`;
      details += `\`\`\`\n${item.actionCommand || queue.generateActionCommand(item)}\n\`\`\`\n\n`;

      details += `## Context\n`;
      details += `- **Status**: ${item.status}\n`;
      details += `- **Tag**: ${item.tag}\n`;
      details += `- **Page URL**: ${item.url}\n`;
      details += `- **Timestamp**: ${item.timestamp}\n\n`;

      if (item.url && item.url.startsWith('file://')) {
        try {
          const directFile = new URL(item.url).pathname;
          details += `## 🎯 Direct File Location\n`;
          details += `- **File on Disk**: \`${directFile}\`\n\n`;
        } catch (_) {}
      }

      details += `## 📝 User Notes\n`;
      details += `> ${item.userNotes || 'None'}\n\n`;

      if (item.reactContext) {
        details += `## ⚛️ React Component\n`;
        details += `- **Component**: \`${item.reactContext.componentName}\`\n`;
        if (item.reactContext.source?.file) {
          details += `- **Source**: \`${item.reactContext.source.file}:${item.reactContext.source.line}\`\n`;
        }
        if (item.reactContext.hierarchy?.length > 0) {
          details += `- **Hierarchy**: ${item.reactContext.hierarchy.join(' > ')}\n`;
        }
        details += '\n';
      }

      details += `## 🎯 DOM Selector\n`;
      details += `- **CSS Selector**: \`${item.selector}\`\n`;
      details += `- **HTML Snippet**:\n\`\`\`html\n${item.outerHTML}\n\`\`\`\n\n`;

      // Computed styles are OPT-IN — skipped by default to save tokens
      if (includeStyles && item.computedStyles && Object.keys(item.computedStyles).length > 0) {
        details += `## 🎨 Computed Styles\n`;
        details += `| Property | Value |\n|---|---|\n`;
        for (const [prop, val] of Object.entries(item.computedStyles)) {
          if (val !== undefined) {
            details += `| \`${prop}\` | \`${val}\` |\n`;
          }
        }
        details += '\n';
      } else if (!includeStyles) {
        details += `> 💡 Computed styles omitted (add \`includeStyles: true\` to see them).\n\n`;
      }

      if (item.areaMarking) {
        details += `## 📍 Freeform Area Marking\n`;
        details += `- **Shape**: \`${item.areaMarking.shape.toUpperCase()}\`\n`;
        details += `- **Dimensions**: X:${item.areaMarking.rect.x}px Y:${item.areaMarking.rect.y}px W:${item.areaMarking.rect.width}px H:${item.areaMarking.rect.height}px\n`;
        if (item.areaMarking.containerSelector) {
          details += `- **Container**: \`${item.areaMarking.containerSelector}\`\n`;
        }
        if (item.areaMarking.relativePosition) {
          details += `- **Placement Hint**: ${item.areaMarking.relativePosition}\n`;
        }
        details += '\n';
      }

      if (item.resolutionNotes) {
        details += `## ✅ Resolution\n`;
        details += `- **Notes**: ${item.resolutionNotes}\n`;
        details += `- **Resolved At**: ${item.resolvedAt}\n`;
      }

      return {
        content: [{ type: 'text', text: details }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool 4: get_latest_ui_feedback
  // ─────────────────────────────────────────────────────────────────────────────
  server.tool('get_latest_ui_feedback', {}, async () => {
    const pendingList = await fetchFeedbackList({ status: 'pending', limit: 1 });
    let item = pendingList && pendingList.length > 0 ? pendingList[0] : null;
    if (!item) {
      queue.init();
      item = queue.getLatestPending();
    }

    if (!item) {
      return {
        content: [{ type: 'text', text: 'No pending UI feedback items currently in queue.' }]
      };
    }

    const comp = item.reactContext?.componentName || item.selector;
    return {
      content: [{
        type: 'text',
        text: `### Latest Pending Feedback: \`${item.id}\`
- **Target**: \`${comp}\`
- **User Notes**: ${item.userNotes}
- **Selector**: \`${item.selector}\`
- **Source**: ${item.reactContext?.source ? `${item.reactContext.source.file}:${item.reactContext.source.line}` : 'N/A'}

**Action Command**:
\`\`\`
${item.actionCommand || queue.generateActionCommand(item)}
\`\`\``
      }]
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool 5: resolve_ui_feedback
  // ─────────────────────────────────────────────────────────────────────────────
  server.tool(
    'resolve_ui_feedback',
    {
      id: z.string().describe('The feedback ID to mark as resolved or dismissed'),
      resolutionNotes: z
        .string()
        .describe('Summary of the code or style changes made to address this feedback'),
      status: z
        .enum(['resolved', 'dismissed'])
        .optional()
        .describe("Target status: 'resolved' or 'dismissed'. Defaults to 'resolved'.")
    },
    async ({ id, resolutionNotes, status = 'resolved' }) => {
      const existing = await fetchFeedback(id);
      if (!existing) {
        return {
          content: [{
            type: 'text',
            text: `Error: Feedback item with ID "${id}" was not found.`
          }]
        };
      }

      await notifyBridgeServer(id, { status, resolutionNotes });

      return {
        content: [{
          type: 'text',
          text: `✅ Feedback \`${id}\` marked as **${status.toUpperCase()}**!
- **Resolution**: ${resolutionNotes}
- **Browser Notification**: Real-time SSE event dispatched — marker turns green in the browser.`
        }]
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool 6: clear_ui_feedback
  // ─────────────────────────────────────────────────────────────────────────────
  server.tool(
    'clear_ui_feedback',
    {
      status: z
        .enum(['resolved', 'dismissed', 'all'])
        .optional()
        .describe("Which items to clear: 'resolved', 'dismissed', or 'all'. Defaults to 'resolved'.")
    },
    async ({ status = 'resolved' }) => {
      queue.init();
      queue.clearQueue({ status });
      return {
        content: [{
          type: 'text',
          text: `Cleared items with status="${status}" from the UI feedback queue.`
        }]
      };
    }
  );

  // MCP Resources
  server.resource('ui-feedback-queue', 'feedback://queue', async (uri) => {
    queue.init();
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(queue.items, null, 2),
        mimeType: 'application/json'
      }]
    };
  });

  server.resource('ui-feedback-latest', 'feedback://latest', async (uri) => {
    queue.init();
    const latest = queue.getLatestPending();
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(latest || null, null, 2),
        mimeType: 'application/json'
      }]
    };
  });

  return {
    server,
    queue,
    startStdio: async () => {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('[MarkupBridge MCP] Server connected via stdio transport');
    }
  };
}
