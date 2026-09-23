import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedbackQueue } from '../server/queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const BRIDGE_API_BASE = process.env.BRIDGE_API_BASE || 'http://127.0.0.1:3005';

export function createMcpServer({
  storageDir = path.resolve(ROOT_DIR, '.antigravity')
} = {}) {
  const queue = new FeedbackQueue(storageDir);

  const server = new McpServer({
    name: 'antigravity-ui-bridge',
    version: '1.0.0'
  });

  // Helper to sync update with running HTTP bridge server for SSE broadcast
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
      // Bridge server might not be running or unreachable; fallback to direct queue update
    }
    return queue.updateFeedback(id, updates);
  }

  // 1. Tool: list_ui_feedback
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
      // Reload queue from disk in case updated by web client
      queue.init();
      const items = queue.listFeedback({ status, limit });

      if (items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No UI feedback items found with status="${status}".`
            }
          ]
        };
      }

      const formatted = items.map((item, idx) => {
        const comp = item.reactContext?.componentName || 'DOM Element';
        const src = item.reactContext?.source
          ? ` (${item.reactContext.source.file}:${item.reactContext.source.line})`
          : '';
        return `### [${idx + 1}] Feedback ID: \`${item.id}\`
- **Status**: ${item.status.toUpperCase()} (${item.tag || 'general'})
- **Target Component**: \`${comp}\`${src}
- **CSS Selector**: \`${item.selector}\`
- **User Requested Changes**:
> ${item.userNotes || 'No notes provided'}
- **Created**: ${item.timestamp}
- **Page URL**: ${item.url || 'N/A'}`;
      }).join('\n\n---\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${items.length} feedback item(s):\n\n${formatted}`
          }
        ]
      };
    }
  );

  // 2. Tool: get_ui_feedback
  server.tool(
    'get_ui_feedback',
    {
      id: z.string().describe('The feedback ID (e.g. fb_1774330623123_a8b9)')
    },
    async ({ id }) => {
      queue.init();
      const item = queue.getFeedback(id);

      if (!item) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: UI feedback item with ID "${id}" was not found.`
            }
          ]
        };
      }

      let details = `# UI Visual Feedback Item: ${item.id}\n\n`;
      details += `- **Status**: ${item.status}\n`;
      details += `- **Tag / Category**: ${item.tag}\n`;
      details += `- **Page URL**: ${item.url}\n`;
      details += `- **Timestamp**: ${item.timestamp}\n\n`;

      details += `## 📝 User Requested Notes\n`;
      details += `> ${item.userNotes || 'None'}\n\n`;

      if (item.reactContext) {
        details += `## ⚛️ React Component Context\n`;
        details += `- **Component Name**: \`${item.reactContext.componentName}\`\n`;
        if (item.reactContext.source && item.reactContext.source.file) {
          details += `- **Source File**: \`${item.reactContext.source.file}\`\n`;
          details += `- **Line**: \`${item.reactContext.source.line}\`, **Column**: \`${item.reactContext.source.column}\`\n`;
        }
        if (item.reactContext.hierarchy && item.reactContext.hierarchy.length > 0) {
          details += `- **Component Hierarchy**: ${item.reactContext.hierarchy.join(' > ')}\n`;
        }
        if (item.reactContext.props) {
          details += `- **Props Summary**: \`\`\`json\n${JSON.stringify(item.reactContext.props, null, 2)}\n\`\`\`\n`;
        }
        details += `\n`;
      }

      details += `## 🎯 DOM & Selector\n`;
      details += `- **CSS Selector**: \`${item.selector}\`\n`;
      details += `- **Outer HTML Snippet** (sanitized, <= 400 chars):\n\`\`\`html\n${item.outerHTML}\n\`\`\`\n\n`;

      if (item.computedStyles && Object.keys(item.computedStyles).length > 0) {
        details += `## 🎨 Critical Computed Styles\n`;
        details += `| Property | Value |\n|---|---|\n`;
        for (const [prop, val] of Object.entries(item.computedStyles)) {
          if (val !== undefined) {
            details += `| \`${prop}\` | \`${val}\` |\n`;
          }
        }
        details += `\n`;
      }

      if (item.areaMarking) {
        details += `## 📍 Freeform Area / Spatial Marking\n`;
        details += `- **Shape**: \`${item.areaMarking.shape.toUpperCase()}\`\n`;
        details += `- **Dimensions & Position**: \`X: ${item.areaMarking.rect.x}px, Y: ${item.areaMarking.rect.y}px, Width: ${item.areaMarking.rect.width}px, Height: ${item.areaMarking.rect.height}px\`\n`;
        if (item.areaMarking.containerSelector) {
          details += `- **Nearest Container Element**: \`${item.areaMarking.containerSelector}\`\n`;
        }
        if (item.areaMarking.relativePosition) {
          details += `- **Spatial Placement Hint**: ${item.areaMarking.relativePosition}\n`;
        }
        details += `\n`;
      }

      if (item.screenshotSnippet) {
        details += `## 📸 Visual Bounding Rect\n`;
        if (item.screenshotSnippet.rect) {
          details += `- Coordinates: \`x: ${item.screenshotSnippet.rect.x}, y: ${item.screenshotSnippet.rect.y}, w: ${item.screenshotSnippet.rect.width}px, h: ${item.screenshotSnippet.rect.height}px\`\n`;
        }
      }

      if (item.resolutionNotes) {
        details += `## ✅ Resolution\n`;
        details += `- **Notes**: ${item.resolutionNotes}\n`;
        details += `- **Resolved At**: ${item.resolvedAt}\n`;
      }

      return {
        content: [
          {
            type: 'text',
            text: details
          }
        ]
      };
    }
  );

  // 3. Tool: get_latest_ui_feedback
  server.tool('get_latest_ui_feedback', {}, async () => {
    queue.init();
    const item = queue.getLatestPending();

    if (!item) {
      return {
        content: [
          {
            type: 'text',
            text: 'No pending UI feedback items currently in queue.'
          }
        ]
      };
    }

    const comp = item.reactContext?.componentName || item.selector;
    return {
      content: [
        {
          type: 'text',
          text: `### Latest Pending Feedback: \`${item.id}\`
- **Target**: \`${comp}\`
- **User Notes**: ${item.userNotes}
- **Selector**: \`${item.selector}\`
- **Source**: ${item.reactContext?.source ? `${item.reactContext.source.file}:${item.reactContext.source.line}` : 'N/A'}`
        }
      ]
    };
  });

  // 4. Tool: resolve_ui_feedback
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
      queue.init();
      const existing = queue.getFeedback(id);
      if (!existing) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Feedback item with ID "${id}" was not found.`
            }
          ]
        };
      }

      const updated = await notifyBridgeServer(id, {
        status,
        resolutionNotes
      });

      return {
        content: [
          {
            type: 'text',
            text: `✅ Feedback \`${id}\` marked as **${status.toUpperCase()}**!
- **Resolution Summary**: ${resolutionNotes}
- **Client Notification**: Dispatched real-time SSE event to active browser sessions.`
          }
        ]
      };
    }
  );

  // 5. Tool: clear_ui_feedback
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
        content: [
          {
            type: 'text',
            text: `Cleared items with status="${status}" from the UI feedback queue.`
          }
        ]
      };
    }
  );

  // MCP Resources
  server.resource(
    'ui-feedback-queue',
    'feedback://queue',
    async (uri) => {
      queue.init();
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(queue.items, null, 2),
            mimeType: 'application/json'
          }
        ]
      };
    }
  );

  server.resource(
    'ui-feedback-latest',
    'feedback://latest',
    async (uri) => {
      queue.init();
      const latest = queue.getLatestPending();
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(latest || null, null, 2),
            mimeType: 'application/json'
          }
        ]
      };
    }
  );

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
