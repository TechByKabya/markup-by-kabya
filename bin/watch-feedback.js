#!/usr/bin/env node

/**
 * Watcher for incoming UI feedback.
 * Waits until a new pending feedback item is submitted via the browser bridge,
 * then prints the details and exits, triggering Antigravity's reactive wakeup!
 */

import fs from 'node:fs';
import path from 'node:path';

const QUEUE_FILE = path.resolve(process.cwd(), '.antigravity/ui_feedback_queue.json');

function getPendingItems() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items.filter(i => i.status === 'pending') : [];
  } catch (_) {
    return [];
  }
}

// 1. Check if there are already pending items
const currentPending = getPendingItems();
if (currentPending.length > 0) {
  const latest = currentPending[0];
  console.log(`\n⚡ [AutoBridge] Pending UI feedback detected!`);
  console.log(`- ID: ${latest.id}`);
  console.log(`- Target: ${latest.reactContext?.componentName || latest.selector}`);
  console.log(`- Notes: "${latest.userNotes}"\n`);
  process.exit(0);
}

console.log('👀 [AutoBridge] Watching for new UI feedback from browser...');

// 2. Poll/watch until a new pending item appears
const interval = setInterval(() => {
  const pending = getPendingItems();
  if (pending.length > 0) {
    clearInterval(interval);
    const latest = pending[0];
    console.log(`\n⚡ [AutoBridge] New UI feedback received from browser!`);
    console.log(`- ID: ${latest.id}`);
    console.log(`- Target: ${latest.reactContext?.componentName || latest.selector}`);
    console.log(`- Notes: "${latest.userNotes}"\n`);
    process.exit(0);
  }
}, 500);

// Timeout safety after 15 minutes
setTimeout(() => {
  clearInterval(interval);
  process.exit(0);
}, 900000);
