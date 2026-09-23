#!/usr/bin/env node
/**
 * check-pending.js — Markup Bridge Pre-Invocation Hook
 *
 * Runs before each Antigravity chat turn (via hooks.json PreInvocation).
 *
 * Strategy:
 *   1. Try the live HTTP bridge server for fresh, authoritative data
 *   2. Fall back to the on-disk queue file if server is not running
 *   3. For fresh pending items (submitted within FRESH_WINDOW_MS):
 *      - Inject an `autoMessage` so Antigravity starts executing immediately
 *        without the user needing to type anything
 *   4. For older pending items: inject an `ephemeralMessage` reminder
 *   5. For no pending items: output empty injectSteps (silent)
 *
 * KEY IMPROVEMENT over the old version:
 *   - Uses the pre-generated `actionCommand` field (built at feedback creation time)
 *     so the agent can act with ZERO additional MCP tool calls
 *   - Detects "fresh" vs "stale" feedback to avoid repetitive auto-triggering
 *   - Queries the HTTP server first for accuracy (not stale file reads)
 */

import fs from 'node:fs';
import path from 'node:path';

const BRIDGE_API_BASE = process.env.BRIDGE_API_BASE || 'http://127.0.0.1:3005';

// Items submitted within this window are considered "fresh" and trigger auto-execution
const FRESH_WINDOW_MS = 90_000; // 90 seconds

// How long to keep silent about a stale item (avoid spam on every message)
// Stale items show a gentle reminder at most once every N turns
const STALE_REMINDER_INTERVAL_MS = 300_000; // 5 minutes

async function getPendingFromServer() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${BRIDGE_API_BASE}/api/feedback/action-queue?fresh=false&limit=10`, {
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return data.commands || [];
    }
  } catch (_) {}
  return null; // null = server not reachable
}

function getPendingFromFile() {
  // Resolve queue file — respect MARKUP_BRIDGE_STORAGE env var
  const storageDir = process.env.MARKUP_BRIDGE_STORAGE
    || path.resolve(process.cwd(), '.antigravity');
  const queueFile = path.join(storageDir, 'ui_feedback_queue.json');

  try {
    if (!fs.existsSync(queueFile)) return [];
    const raw = fs.readFileSync(queueFile, 'utf8');
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];

    return items
      .filter(i => i.status === 'pending')
      .map(item => ({
        id: item.id,
        timestamp: item.timestamp,
        // Rebuild actionCommand from stored data if missing (backward compat)
        actionCommand: item.actionCommand || buildLegacyActionCommand(item)
      }));
  } catch (_) {
    return [];
  }
}

/**
 * Backward-compatible fallback for old queue entries without actionCommand.
 */
function buildLegacyActionCommand(item) {
  const change = item.userNotes ? `"${item.userNotes}"` : 'no notes provided';
  const component = item.reactContext?.componentName || null;
  const sourceFile = item.reactContext?.source?.file || null;
  const sourceLine = item.reactContext?.source?.line || null;

  let filePath = null;
  if (sourceFile) {
    filePath = sourceLine ? `${sourceFile}:${sourceLine}` : sourceFile;
  } else if (item.url && item.url.startsWith('file://')) {
    try { filePath = new URL(item.url).pathname; } catch (_) {}
  }

  const lines = [];
  if (component) {
    lines.push(`Change ${change} in component \`${component}\``);
  } else {
    lines.push(`Change ${change}`);
  }
  if (filePath) lines.push(`File: \`${filePath}\``);
  lines.push(`Selector: \`${item.selector}\``);
  lines.push(`Feedback ID: \`${item.id}\``);
  lines.push(`→ Edit the file above to apply the change, then call resolve_ui_feedback({ id: "${item.id}", resolutionNotes: "..." })`);
  return lines.join('\n');
}

async function main() {
  // Step 1: Get pending items
  let pending = await getPendingFromServer();
  const usedServer = pending !== null;
  if (!usedServer) {
    pending = getPendingFromFile();
  }

  if (!pending || pending.length === 0) {
    // Nothing pending — silent exit
    console.log(JSON.stringify({ injectSteps: [] }));
    return;
  }

  const now = Date.now();

  // Step 2: Partition into fresh vs stale
  const freshItems = pending.filter(p => {
    const age = now - new Date(p.timestamp).getTime();
    return age <= FRESH_WINDOW_MS;
  });
  const staleItems = pending.filter(p => {
    const age = now - new Date(p.timestamp).getTime();
    return age > FRESH_WINDOW_MS;
  });

  // Step 3: Build the auto-execution message for FRESH items
  if (freshItems.length > 0) {
    const commandBlocks = freshItems.map((p, idx) =>
      `### UI Change Request [${idx + 1}/${freshItems.length}]\n${p.actionCommand}`
    ).join('\n\n---\n\n');

    const autoText = freshItems.length === 1
      ? `🎯 New UI feedback from browser — auto-executing now:\n\n${commandBlocks}`
      : `🎯 ${freshItems.length} new UI feedback items from browser — auto-executing now:\n\n${commandBlocks}`;

    // autoMessage causes Antigravity to immediately start a new agent turn
    // without the user needing to type anything.
    // IMPORTANT: Use the markup-bridge skill workflow.
    const fullAutoText = `${autoText}

---
**Instructions for Antigravity**: Apply each change above directly. For each item:
1. Open the specified file and apply the change
2. Call \`resolve_ui_feedback\` with the feedback ID and a brief resolutionNotes summary
3. Do NOT call \`list_ui_feedback\` or \`get_ui_feedback\` unless the actionCommand is ambiguous or missing a file path (e.g. freeform area markings)`;

    console.log(JSON.stringify({
      injectSteps: [
        {
          autoMessage: fullAutoText
        }
      ]
    }));
    return;
  }

  // Step 4: For stale items only — show a gentle reminder (ephemeral, not auto-executing)
  if (staleItems.length > 0) {
    const summary = staleItems.map((p, idx) => {
      const ageMin = Math.round((now - new Date(p.timestamp).getTime()) / 60000);
      return `[${idx + 1}] (${ageMin}m ago, ID: ${p.id})\n${p.actionCommand}`;
    }).join('\n\n---\n\n');

    console.log(JSON.stringify({
      injectSteps: [
        {
          ephemeralMessage: `⏳ ${staleItems.length} older pending UI feedback item(s) still awaiting resolution:\n\n${summary}\n\nType "apply markup feedback" to process these.`
        }
      ]
    }));
    return;
  }

  console.log(JSON.stringify({ injectSteps: [] }));
}

main().catch(() => {
  console.log(JSON.stringify({ injectSteps: [] }));
});
