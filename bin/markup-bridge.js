#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
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
    // Delegate to check-pending.js which handles:
    //   - Fresh items (submitted < 90s ago) → autoMessage (agent auto-executes)
    //   - Stale items → ephemeralMessage reminder
    //   - Pre-built actionCommand so agent needs 0 extra MCP tool calls
    const { spawnSync } = await import('node:child_process');
    const checkScript = path.resolve(__dirname, 'check-pending.js');
    const result = spawnSync(process.execPath, [checkScript], {
      env: {
        ...process.env,
        BRIDGE_API_BASE: process.env.BRIDGE_API_BASE || 'http://127.0.0.1:3005',
        MARKUP_BRIDGE_STORAGE: process.env.MARKUP_BRIDGE_STORAGE || path.resolve(process.cwd(), '.antigravity')
      },
      encoding: 'utf8',
      timeout: 5000
    });
    if (result.stdout) process.stdout.write(result.stdout);
    else console.log(JSON.stringify({ injectSteps: [] }));
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
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  mcpConfig.mcpServers["markup-bridge"] = {
    "command": npxCmd,
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
description: >-
  Processes and applies visual UI feedback collected from the browser via Markup Bridge.
  Use when the user types /markup, 'apply feedback', 'fix ui', or when pending browser feedback needs execution.
---

# Markup Bridge: Visual UI Feedback Workflow

This skill applies pending visual UI feedback collected from the browser using the Markup Bridge Chrome extension.

## When to Run
- User types \`/markup\`
- User requests to "apply feedback", "fix UI issues", or "resolve browser notes"
- Pending UI change requests are injected via pre-invocation hook

## Execution Procedure

### Step 1: Discover Pending Feedback
Check the pending queue using the MCP tool:
\`\`\`json
call_mcp_tool({
  "ServerName": "markup-bridge",
  "ToolName": "get_action_command",
  "Arguments": { "limit": 10 }
})
\`\`\`
Or call \`list_ui_feedback\` for deep metadata.

### Step 2: Batch and Apply Code Changes
For each pending item:
1. Identify the target file from the pre-digested \`actionCommand\` or React component source. If only a CSS selector is provided, locate the corresponding element in the project template/components.
2. Read the file, make the requested change (text, styling, layout, or feature).
3. Ensure no regressions or syntax errors.

### Step 3: Mark Feedback as Resolved
Immediately resolve each item so the browser visual pin turns green and the badge decrements:
\`\`\`json
call_mcp_tool({
  "ServerName": "markup-bridge",
  "ToolName": "resolve_ui_feedback",
  "Arguments": {
    "id": "<feedback_id>",
    "resolutionNotes": "Brief description of the change applied",
    "status": "resolved"
  }
})
\`\`\`

### Step 4: Summary for User
Provide a concise summary listing each feedback ID, what file was modified, and clickable links to the modified files.
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
To force restart:
  macOS/Linux: lsof -ti:3005 | xargs kill -9 && npx markup-bridge@latest
  Windows:     npx kill-port 3005 && npx markup-bridge@latest
`);
    process.exit(0);
  }
  console.error('[MarkupBridge Fatal]:', err);
  process.exit(1);
});
