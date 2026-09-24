import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FeedbackQueue } from '../src/server/queue.js';

test('FeedbackQueue handles design-clone tag with file-path protocol and generates rich actionCommand', async () => {
  const tmpDir = path.join(os.tmpdir(), `mb_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const queue = new FeedbackQueue(tmpDir);

    // New protocol: designFilePath (not designBlueprintPrompt)
    const designFilePath = '/Users/test/.antigravity/designs/example-com-2026-09-24t0146.html';
    const item = queue.addFeedback({
      url: 'https://example.com/landing',
      pageTitle: 'Modern AI Studio',
      tag: 'design-clone',
      userNotes: 'Recreate full page design for "Modern AI Studio"',
      designFilePath,
      designMetadata: {
        slug: 'example-com-2026-09-24t0146',
        sourceUrl: 'https://example.com/landing',
        pageTitle: 'Modern AI Studio',
        capturedAt: '2026-09-24T01:46:00.000Z',
        viewport: '1440x900',
        estimatedNodes: 247,
        fileSizeBytes: 180000,
        detectedStack: ['React', 'Next.js', 'Tailwind CSS'],
        fallback: false,
      },
    });

    // Verify basic fields
    assert.ok(item.id.startsWith('fb_'));
    assert.strictEqual(item.status, 'pending');
    assert.strictEqual(item.tag, 'design-clone');
    assert.strictEqual(item.pageTitle, 'Modern AI Studio');
    assert.strictEqual(item.designFilePath, designFilePath);
    assert.ok(item.designMetadata, 'designMetadata should be stored');
    assert.strictEqual(item.designMetadata.estimatedNodes, 247);
    assert.strictEqual(item.designMetadata.fileSizeBytes, 180000);

    // Verify actionCommand uses the NEW file-path protocol
    assert.ok(item.actionCommand.includes('🎯 FULL PAGE CLONE READY: "Modern AI Studio"'),
      'Action command should contain FULL PAGE CLONE READY header');
    assert.ok(item.actionCommand.includes(`📄 Design File: \`${designFilePath}\``),
      'Action command should include the design file path');
    assert.ok(item.actionCommand.includes('view_file'),
      'Action command should instruct Antigravity to call view_file');
    assert.ok(item.actionCommand.includes('INSTRUCTIONS:'),
      'Action command should include INSTRUCTIONS section');
    assert.ok(item.actionCommand.includes(`Feedback ID: \`${item.id}\``),
      'Action command should include the feedback ID');
    assert.ok(item.actionCommand.includes('resolve_ui_feedback'),
      'Action command should reference resolve_ui_feedback');
    assert.ok(item.actionCommand.includes('React, Next.js, Tailwind CSS'),
      'Action command should include detected stack');

    // Verify OLD blueprint format is NOT present
    assert.ok(!item.actionCommand.includes('REDESIGN & CLONE BLUEPRINT'),
      'Action command should NOT use old blueprint format');

    // Verify resolving the clone item
    const updated = queue.updateFeedback(item.id, {
      status: 'resolved',
      resolutionNotes: 'Page recreated with 1:1 fidelity from serialized DOM capture'
    });
    assert.strictEqual(updated.status, 'resolved');
    assert.strictEqual(updated.resolutionNotes, 'Page recreated with 1:1 fidelity from serialized DOM capture');
    assert.ok(updated.resolvedAt);

    // Allow debounce write to finish before cleanup
    await new Promise(r => setTimeout(r, 80));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('FeedbackQueue setStorageDir dynamically switches storage location', async () => {
  const dirA = path.join(os.tmpdir(), `mb_test_dirA_${Date.now()}`);
  const dirB = path.join(os.tmpdir(), `mb_test_dirB_${Date.now()}`);
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  try {
    const queue = new FeedbackQueue(dirA);
    queue.addFeedback({ selector: 'h1', userNotes: 'Feedback in dir A' });
    assert.strictEqual(queue.items.length, 1);
    assert.strictEqual(queue.storageDir, path.resolve(dirA));

    // Switch to dir B
    queue.setStorageDir(dirB);
    assert.strictEqual(queue.storageDir, path.resolve(dirB));
    assert.strictEqual(queue.items.length, 0);

    // Add item to dir B
    queue.addFeedback({ selector: 'h2', userNotes: 'Feedback in dir B' });
    assert.strictEqual(queue.items.length, 1);
    assert.strictEqual(queue.items[0].userNotes, 'Feedback in dir B');

    await new Promise(r => setTimeout(r, 80));
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

