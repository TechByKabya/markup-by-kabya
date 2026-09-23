#!/usr/bin/env node
/**
 * check-pending.js — Markup Bridge Pre-Invocation Hook
 *
 * Runs before each Antigravity chat turn (via hooks.json PreInvocation).
 *
 * Strategy:
 *   1. Try the live HTTP bridge server for fresh, authoritative data
 *   2. Fall back to the on-disk queue file if server is not running
 *   3. ANY pending item (regardless of age) → autoMessage
 *      This triggers Antigravity to start executing immediately,
 *      without the user needing to type anything in chat.
 *   4. No pending items → empty injectSteps (silent)
 */

import fs from 'node:fs';
import path from 'node:path';

const BRIDGE_API_BASE = process.env.BRIDGE_API_BASE || 'http://127.0.0.1:3005';

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
        actionCommand: item.actionCommand || buildLegacyActionCommand(item)
      }));
  } catch (_) {
    return [];
  }
}

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
  if (pending === null) {
    pending = getPendingFromFile();
  }

  if (!pending || pending.length === 0) {
    // Nothing pending — silent exit
    console.log(JSON.stringify({ injectSteps: [] }));
    return;
  }

  // Step 2: ALL pending items trigger autoMessage — no fresh/stale split.
  // Resolved items are removed from the queue, so anything pending
  // is genuinely unresolved work that needs to be acted on.
  const commandBlocks = pending.map((p, idx) =>
    `### UI Change Request [${idx + 1}/${pending.length}]\n${p.actionCommand}`
  ).join('\n\n---\n\n');

  const intro = pending.length === 1
    ? `🎯 UI feedback from browser — executing now:`
    : `🎯 ${pending.length} UI feedback items from browser — executing now:`;

  const fullMessage = `${intro}\n\n${commandBlocks}\n\n---\n**Instructions**: For each item above:\n1. Open the specified file and apply the change\n2. Call \`resolve_ui_feedback\` with the feedback ID and brief resolutionNotes\n3. Only call \`get_ui_feedback\` if the actionCommand lacks a file path`;

  console.log(JSON.stringify({
    injectSteps: [{ userMessage: fullMessage }]
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ injectSteps: [] }));
});
