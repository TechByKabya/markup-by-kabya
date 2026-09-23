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
  // 1. Setup the background config so it auto-starts next time
  const fs = await import('node:fs');
  const path = await import('node:path');
  const agentsDir = path.resolve(process.cwd(), '.agents');
  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });

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
    "args": ["-y", "markup-by-kabya", "dual"],
    "env": { "BRIDGE_API_BASE": "http://127.0.0.1:3005" }
  };
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

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
