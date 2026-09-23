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
Markup Bridge for Antigravity (Bidirectional UI Visual Feedback System)

Usage:
  markup-bridge [command] [options]

Commands:
  server              Start the HTTP bridge server (default, on port 3005)
  mcp                 Start the Model Context Protocol (MCP) stdio server for Antigravity
  dual                Run both the HTTP bridge server and the MCP server concurrently

Options:
  --port=<port>       HTTP port to listen on (default: 3005)
  --host=<host>       HTTP host to bind (default: 127.0.0.1)
  --help, -h          Show this help message

Examples:
  npx markup-bridge server --port=3005
  npx markup-bridge mcp
  npx markup-bridge dual
`);
}

async function main() {
  const options = parseArgs();

  if (command === 'init') {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const agentsDir = path.resolve(process.cwd(), '.agents');
    if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });

    const mcpConfig = {
      mcpServers: {
        "markup-bridge": {
          "command": "node",
          "args": [__filename, "dual"],
          "env": { "BRIDGE_API_BASE": "http://127.0.0.1:3005" }
        }
      }
    };
    fs.writeFileSync(path.join(agentsDir, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2));

    console.log(`
🎉 [MarkupBridge] Project initialized successfully!
📁 Created .agents/mcp_config.json
👉 Start the bridge server with: npx markup-bridge server
👉 Add to your web app: <script src="http://127.0.0.1:3005/client.js"></script>
`);
    return;
  }

  if (command === 'watch') {
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');
    const watchScript = path.resolve(__dirname, 'watch-feedback.js');
    const child = spawn('node', [watchScript], { stdio: 'inherit' });
    child.on('exit', code => process.exit(code || 0));
    return;
  }

  if (command === 'mcp') {
    const mcp = createMcpServer();
    await mcp.startStdio();
    return;
  }

  if (command === 'dual') {
    // In dual mode, start HTTP bridge server without polluting stdout so stdio MCP remains clean
    const bridge = createBridgeServer({ ...options, silent: true });
    await bridge.start();

    const mcp = createMcpServer();
    await mcp.startStdio();
    return;
  }

  // Default: start HTTP bridge server
  const bridge = createBridgeServer(options);
  await bridge.start();

  const shutdown = async () => {
    console.log('\n[MarkupBridge] Shutting down bridge server...');
    await bridge.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`
ℹ️  [MarkupBridge] Bridge server is already running on http://127.0.0.1:3005!
👉 The server is active and ready to receive feedback from your browser.
👉 To restart it, run: lsof -ti:3005 | xargs kill -9 && npm run server
`);
    process.exit(0);
  }
  console.error('[MarkupBridge Fatal]:', err);
  process.exit(1);
});
