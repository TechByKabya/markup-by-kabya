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
    const fs = await import('node:fs');
    const path = await import('node:path');
    const queueFile = path.resolve(process.cwd(), '.antigravity/ui_feedback_queue.json');
    try {
      if (fs.existsSync(queueFile)) {
        const raw = fs.readFileSync(queueFile, 'utf8');
        const items = JSON.parse(raw);
        const pending = Array.isArray(items) ? items.filter(i => i.status === 'pending') : [];
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
    "env": { "BRIDGE_API_BASE": "http://127.0.0.1:3005" }
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
  hooksConfig["markup-bridge-notifier"] = {
    "PreInvocation": [
      {
        "type": "command",
        "command": "npx -y markup-bridge check",
        "timeout": 5
      }
    ]
  };
  fs.writeFileSync(hooksConfigPath, JSON.stringify(hooksConfig, null, 2));

  // 1c. Configure Agent Skill
  const skillDir = path.join(agentsDir, 'skills', 'markup-bridge');
  if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  const skillContent = `---
name: markup-bridge
description: Autonomous pair programming workflow for inspecting and addressing UI visual feedback submitted live from the web browser via Markup Bridge MCP.
---

# Markup Bridge: Visual UI Feedback Workflow

Use this skill whenever pending UI feedback is detected from the browser:
1. Call \`list_ui_feedback({ status: 'pending' })\` to see pending feedback items.
2. Call \`get_ui_feedback({ id })\` to inspect the targeted element, component, and user requested notes.
3. Edit the code to implement the requested UI changes.
4. Call \`resolve_ui_feedback({ id, resolutionNotes })\` to notify the browser and turn the marker green.
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
