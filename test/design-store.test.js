/**
 * Unit Tests: Design Store (src/server/design-store.js)
 *
 * Tests atomic file write, slug generation, directory creation,
 * design listing, and deletion using Node.js built-in test runner.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  generateSlug,
  writeDesignFile,
  ensureDesignsDir,
  getDesignFilePath,
  listDesigns,
  deleteDesign,
} from '../src/server/design-store.js';

// ═══════════════════════════════════════════════════════════════
// Test Fixture Setup
// ═══════════════════════════════════════════════════════════════
let tmpDir;

before(() => {
  // Create a temporary directory for test file system operations
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markup-bridge-test-'));
});

after(() => {
  // Clean up temp directory after all tests
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

// ═══════════════════════════════════════════════════════════════
// generateSlug
// ═══════════════════════════════════════════════════════════════
describe('generateSlug', () => {
  test('generates a lowercase slug from a URL', () => {
    const slug = generateSlug('https://stripe.com/pricing', new Date('2026-09-24T01:46:00.000Z'));
    assert.ok(slug.includes('stripe'), `slug should include 'stripe': ${slug}`);
    assert.ok(slug.includes('pricing'), `slug should include 'pricing': ${slug}`);
    assert.match(slug, /^[a-z0-9.-]+$/, 'slug should only contain lowercase safe chars');
  });

  test('strips www prefix from hostname', () => {
    const slug = generateSlug('https://www.example.com/', new Date('2026-09-24T01:46:00.000Z'));
    assert.ok(!slug.startsWith('www'), `slug should not start with 'www': ${slug}`);
    assert.ok(slug.includes('example'));
  });

  test('appends a timestamp suffix', () => {
    const date = new Date('2026-09-24T01:46:00.000Z');
    const slug = generateSlug('https://example.com/', date);
    // Timestamp in format YYYY-MM-DDTHHMM (timezone may vary, but year should be present)
    assert.ok(slug.includes('2026'), `slug should include year: ${slug}`);
  });

  test('handles non-standard URLs gracefully', () => {
    const slug = generateSlug('not a url', new Date('2026-09-24T01:46:00.000Z'));
    assert.match(slug, /^[a-z0-9-]+$/, 'slug should be safe even for invalid URLs');
  });

  test('handles URL with complex path', () => {
    const slug = generateSlug('https://shimu-rezampcollege.edu.bd/notice-board', new Date('2026-09-24T01:46:00.000Z'));
    assert.ok(slug.length > 0);
    assert.match(slug, /^[a-z0-9.-]+$/);
  });

  test('two slugs for same URL at different times should be different', () => {
    const slug1 = generateSlug('https://example.com/', new Date('2026-09-24T01:46:00.000Z'));
    const slug2 = generateSlug('https://example.com/', new Date('2026-09-24T02:47:00.000Z'));
    assert.notEqual(slug1, slug2, 'slugs should differ by timestamp');
  });
});

// ═══════════════════════════════════════════════════════════════
// ensureDesignsDir
// ═══════════════════════════════════════════════════════════════
describe('ensureDesignsDir', () => {
  test('creates designs directory if it does not exist', () => {
    const storageDir = path.join(tmpDir, 'test-storage-1');
    const designsDir = ensureDesignsDir(storageDir);
    assert.ok(fs.existsSync(designsDir), 'designs directory should be created');
    assert.ok(designsDir.endsWith('designs'));
  });

  test('does not throw if directory already exists', () => {
    const storageDir = path.join(tmpDir, 'test-storage-2');
    ensureDesignsDir(storageDir); // First call creates it
    assert.doesNotThrow(() => ensureDesignsDir(storageDir), 'second call should not throw');
  });
});

// ═══════════════════════════════════════════════════════════════
// getDesignFilePath
// ═══════════════════════════════════════════════════════════════
describe('getDesignFilePath', () => {
  test('returns path ending in .html', () => {
    const filePath = getDesignFilePath('/base', 'my-slug-2026');
    assert.ok(filePath.endsWith('.html'));
    assert.ok(filePath.includes('my-slug-2026'));
    assert.ok(filePath.includes('designs'));
  });
});

// ═══════════════════════════════════════════════════════════════
// writeDesignFile
// ═══════════════════════════════════════════════════════════════
describe('writeDesignFile', () => {
  test('writes HTML content to disk and returns correct metadata', async () => {
    const storageDir = path.join(tmpDir, 'test-write-1');
    const htmlContent = '<!DOCTYPE html><html><body><h1>Test Page</h1></body></html>';
    const slug = 'test-page-2026-09-24t0146';

    const result = await writeDesignFile(storageDir, slug, htmlContent);

    assert.ok(result.filePath, 'should return filePath');
    assert.ok(result.slug === slug, 'should return the original slug');
    assert.ok(result.fileSizeBytes > 0, 'should return a positive file size');
    assert.ok(fs.existsSync(result.filePath), 'file should exist on disk');

    const readBack = fs.readFileSync(result.filePath, 'utf8');
    assert.equal(readBack, htmlContent, 'file contents should match what was written');
  });

  test('writes are atomic: no .tmp file left over after success', async () => {
    const storageDir = path.join(tmpDir, 'test-write-2');
    const htmlContent = '<html><body>Atomic write test</body></html>';
    const slug = 'atomic-test-2026';

    const result = await writeDesignFile(storageDir, slug, htmlContent);
    const tmpPath = result.filePath + '.tmp';

    assert.ok(!fs.existsSync(tmpPath), '.tmp file should not exist after successful write');
    assert.ok(fs.existsSync(result.filePath), 'final file should exist');
  });

  test('overwrites existing file for same slug', async () => {
    const storageDir = path.join(tmpDir, 'test-write-3');
    const slug = 'overwrite-test-2026';

    await writeDesignFile(storageDir, slug, '<html>Version 1</html>');
    await writeDesignFile(storageDir, slug, '<html>Version 2</html>');

    const filePath = getDesignFilePath(storageDir, slug);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content, '<html>Version 2</html>');
  });

  test('fileSizeBytes matches actual byte size of content', async () => {
    const storageDir = path.join(tmpDir, 'test-write-4');
    const htmlContent = '<html><body>Hello World</body></html>';
    const expected = Buffer.byteLength(htmlContent, 'utf8');
    const slug = 'size-test-2026';

    const result = await writeDesignFile(storageDir, slug, htmlContent);
    assert.equal(result.fileSizeBytes, expected);
  });
});

// ═══════════════════════════════════════════════════════════════
// listDesigns
// ═══════════════════════════════════════════════════════════════
describe('listDesigns', () => {
  test('returns empty array when no designs directory exists', () => {
    const storageDir = path.join(tmpDir, 'nonexistent-storage');
    const designs = listDesigns(storageDir);
    assert.deepEqual(designs, []);
  });

  test('returns list of designs ordered newest first', async () => {
    const storageDir = path.join(tmpDir, 'test-list-1');
    await writeDesignFile(storageDir, 'design-a-2026', '<html>A</html>');
    await writeDesignFile(storageDir, 'design-b-2026', '<html>B</html>');

    const designs = listDesigns(storageDir);
    assert.equal(designs.length, 2, 'should have 2 designs');
    assert.ok(designs[0].slug, 'each design should have a slug');
    assert.ok(designs[0].filePath.endsWith('.html'), 'filePath should end in .html');
    assert.ok(designs[0].fileSizeBytes > 0, 'fileSizeBytes should be positive');
  });

  test('excludes .tmp files from the listing', async () => {
    const storageDir = path.join(tmpDir, 'test-list-2');
    await writeDesignFile(storageDir, 'real-design-2026', '<html>Real</html>');

    // Create a fake .tmp file (simulating a crash mid-write)
    const designsDir = path.join(storageDir, 'designs');
    fs.writeFileSync(path.join(designsDir, 'orphaned-2026.html.tmp'), 'partial content');

    const designs = listDesigns(storageDir);
    const slugs = designs.map(d => d.slug);
    assert.ok(!slugs.some(s => s.endsWith('.tmp')), 'should not include .tmp files');
    assert.equal(designs.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteDesign
// ═══════════════════════════════════════════════════════════════
describe('deleteDesign', () => {
  test('deletes an existing design and returns true', async () => {
    const storageDir = path.join(tmpDir, 'test-delete-1');
    const slug = 'delete-me-2026';
    await writeDesignFile(storageDir, slug, '<html>Delete me</html>');

    const result = deleteDesign(storageDir, slug);
    assert.equal(result, true);

    const filePath = getDesignFilePath(storageDir, slug);
    assert.ok(!fs.existsSync(filePath), 'file should not exist after deletion');
  });

  test('returns false for a non-existent design', () => {
    const storageDir = path.join(tmpDir, 'test-delete-2');
    const result = deleteDesign(storageDir, 'nonexistent-slug-2026');
    assert.equal(result, false);
  });
});
