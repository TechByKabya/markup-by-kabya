#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const QUEUE_FILE = path.resolve(process.cwd(), '.antigravity/ui_feedback_queue.json');

try {
  if (fs.existsSync(QUEUE_FILE)) {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    const items = JSON.parse(raw);
    const pending = Array.isArray(items) ? items.filter(i => i.status === 'pending') : [];

    if (pending.length > 0) {
      const summary = pending.map(p => 
        `- [${p.id}] ${p.reactContext?.componentName || p.selector}: "${p.userNotes}"`
      ).join('\n');

      const output = {
        injectSteps: [
          {
            ephemeralMessage: `📢 PENDING UI FEEDBACK from Browser:\n${summary}\n\nUse MCP get_ui_feedback to inspect and resolve.`
          }
        ]
      };
      console.log(JSON.stringify(output));
      process.exit(0);
    }
  }
} catch (_) {}

console.log(JSON.stringify({ injectSteps: [] }));
