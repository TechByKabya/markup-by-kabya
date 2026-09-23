#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgeServer } from '../src/server/index.js';
import { createMcpServer } from '../src/mcp/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const command = args[0] || 'server';

function parseArgs() {
  const options = {
    port: 3005,
    host: '127.0.0.1'
  };

  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      options.port = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--host=')) {
      options.host = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Markup Bridge (Visual UI Feedback System)

Usage:
  npx markup-bridge             Start the daemon and configure it to auto-run in this project
  npx markup-bridge uninstall   Remove the auto-run configuration from this project

Options:
  --port=<port>       HTTP port to listen on (default: 3005)
  --help, -h          Show this help message
`);
}

async function main() {
  const options = parseArgs();

  if (command === 'uninstall' || command === 'remove') {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const mcpConfigPath = path.resolve(process.cwd(), '.agents', 'mcp_config.json');

    if (fs.existsSync(mcpConfigPath)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        if (mcpConfig.mcpServers && mcpConfig.mcpServers["markup-bridge"]) {
          delete mcpConfig.mcpServers["markup-bridge"];
          fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
          console.log(`[MarkupBridge] Successfully removed background daemon configuration.`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    return;
  }

  if (command === 'check') {
    let pending = [];

    // 1. Try querying running HTTP daemon on 127.0.0.1:3005 first
    try {
      const res = await fetch('http://127.0.0.1:3005/api/feedback?status=pending');
      if (res.ok) {
        const data = await res.json();
        pending = data.items || [];
      }
    } catch (_) {}

    // 2. Fallback to local queue file if daemon unreachable
    if (pending.length === 0) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const queueFile = path.resolve(process.cwd(), '.antigravity/ui_feedback_queue.json');
        if (fs.existsSync(queueFile)) {
          const raw = fs.readFileSync(queueFile, 'utf8');
          const items = JSON.parse(raw);
          pending = Array.isArray(items) ? items.filter(i => i.status === 'pending') : [];
        }
      } catch (_) {}
    }

    try {
      if (pending.length > 0) {
          const summary = pending.map((p, idx) => {
            let targetFile = '';
            if (p.reactContext?.source?.file) {
              targetFile = p.reactContext.source.file;
            } else if (p.url && p.url.startsWith('file://')) {
              try { targetFile = new URL(p.url).pathname; } catch (_) {}
            }
            return `### Feedback Item [${idx + 1}] (ID: ${p.id})
- **User Requested Change**: "${p.userNotes}"
- **Target Selector**: \`${p.selector}\`
${targetFile ? `- **Target File**: \`${targetFile}\`` : ''}
${p.outerHTML ? `- **HTML Element to Edit**:\n\`\`\`html\n${p.outerHTML.slice(0, 300)}\n\`\`\`` : ''}`;
          }).join('\n\n---\n\n');

          console.log(JSON.stringify({
            injectSteps: [
              {
                ephemeralMessage: `📢 PENDING UI FEEDBACK from Browser:\n\n${summary}\n\nPlease open the target file above and apply the requested change directly.`
              }
            ]
          }));
          process.exit(0);
        }
      } catch (_) {}
    console.log(JSON.stringify({ injectSteps: [] }));
    return;
  }

  if (command === 'mcp') {
    const mcp = createMcpServer();
    await mcp.startStdio();
    return;
  }

  if (command === 'dual') {
    const bridge = createBridgeServer({ ...options, silent: true });
    await bridge.start();
    const mcp = createMcpServer();
    await mcp.startStdio();
    return;
  }

  // DEFAULT BEHAVIOR: npx markup-bridge
  // 1. Setup the background config so it auto-starts in this project
  const fs = await import('node:fs');
  const path = await import('node:path');
  const agentsDir = path.resolve(process.cwd(), '.agents');
  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });

  // 1a. Configure MCP Server
  const mcpConfigPath = path.join(agentsDir, 'mcp_config.json');
  let mcpConfig = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    } catch (e) {}
  }
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
  mcpConfig.mcpServers["markup-bridge"] = {
    "command": "npx",
    "args": ["-y", "markup-bridge", "mcp"],
    "env": {
      "BRIDGE_API_BASE": "http://127.0.0.1:3005",
      "MARKUP_BRIDGE_STORAGE": path.resolve(process.cwd(), '.antigravity')
    }
  };
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  // 1b. Configure Lifecycle Hook (Auto-detects pending feedback on next chat message)
  const hooksConfigPath = path.join(agentsDir, 'hooks.json');
  let hooksConfig = {};
  if (fs.existsSync(hooksConfigPath)) {
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
    } catch (e) {}
  }
  hooksConfig["markup-bridge-auto-executor"] = {
    "PreInvocation": [
      {
        "type": "command",
        "command": "npx -y markup-bridge check",
        "timeout": 5
      }
    ]
  };
  // Remove old hook key if present (cleanup)
  delete hooksConfig["markup-bridge-notifier"];
  fs.writeFileSync(hooksConfigPath, JSON.stringify(hooksConfig, null, 2));

  // 1c. Configure Agent Skill
  const skillDir = path.join(agentsDir, 'skills', 'markup-bridge');
  if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  const skillContent = `---
name: markup-bridge
description: Zero-tool-call autonomous workflow for UI visual feedback from the browser. When fresh feedback arrives via autoMessage, act immediately using the pre-built ActionCommand — no extra MCP calls needed.
---

# Markup Bridge: Autonomous UI Feedback Workflow (v2)

## When autoMessage fires with \'🎯 New UI feedback from browser\':

### Case 1: ActionCommand has a File path (most common)
1. Open the file at the specified path/line
2. Apply the change described in the Action Command
3. Call \`resolve_ui_feedback({ id, resolutionNotes: "brief summary" })\`

Do NOT call \`list_ui_feedback\` or \`get_ui_feedback\` — the ActionCommand has everything.

### Case 2: No File path in ActionCommand
1. Use the CSS Selector to grep the codebase for the matching file
2. Apply the change
3. Call \`resolve_ui_feedback\`

### Case 3: Freeform Area Marking (Rectangle/Circle/Pin)
1. Call \`get_ui_feedback({ id })\` for spatial context
2. Insert the new component at the specified container + position
3. Call \`resolve_ui_feedback\`

## MCP Tools (only when needed)
- \`get_action_command\` — scan pending items without heavy data
- \`get_ui_feedback({ id, includeStyles: false })\` — deep context, no CSS dump
- \`get_ui_feedback({ id, includeStyles: true })\` — include computed styles
- \`resolve_ui_feedback({ id, resolutionNotes, status })\` — mark done, notify browser
- \`list_ui_feedback\` — browse all pending items
`;
  fs.writeFileSync(skillFile, skillContent, 'utf8');

  // 2. Start the foreground server immediately so it works right now
  const bridge = createBridgeServer(options);
  await bridge.start();

  const shutdown = () => {
    console.log('\n[MarkupBridge] Shutting down bridge server...');
    bridge.close(); 
    setTimeout(() => process.exit(0), 100); 
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`
[MarkupBridge] Note: Bridge server is already running on http://127.0.0.1:3005.
The server is active and ready to receive feedback.
To force restart, run: lsof -ti:3005 | xargs kill -9 && npm run server
`);
    process.exit(0);
  }
  console.error('[MarkupBridge Fatal]:', err);
  process.exit(1);
});
