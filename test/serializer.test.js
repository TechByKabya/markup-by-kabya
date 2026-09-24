/**
 * Unit Tests: DOM Serializer Engine (src/client/serializer.js)
 *
 * Tests the pure functions in the serializer module using Node.js built-in test runner.
 * These tests run in Node.js (not a browser), so DOM-dependent functions like
 * serializePageToHTML() and extractCriticalStyles() are tested indirectly or
 * with stubs. Pure utility functions are tested directly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSlug as _generateSlug,
  writeDesignFile,
  ensureDesignsDir,
  getDesignFilePath,
  listDesigns,
  deleteDesign,
} from '../src/server/design-store.js';

// We test the serializer utilities by importing them selectively.
// Since serializer.js uses browser globals (Node, window), we test only
// the pure utility functions that work in Node.js context.
import {
  resolveUrl,
  resolveSrcset,
  escapeAttr,
  escapeText,
  generateClassName,
  filterNode,
  assembleCssFromStyleMap,
} from '../src/client/serializer.js';

// ═══════════════════════════════════════════════════════════════
// resolveUrl
// ═══════════════════════════════════════════════════════════════
describe('resolveUrl', () => {
  test('resolves relative URL against base', () => {
    const result = resolveUrl('/images/logo.png', 'https://example.com/about');
    assert.equal(result, 'https://example.com/images/logo.png');
  });

  test('passes through absolute URLs unchanged', () => {
    const abs = 'https://cdn.example.com/image.png';
    assert.equal(resolveUrl(abs, 'https://example.com/'), abs);
  });

  test('passes through data URIs unchanged', () => {
    const dataUri = 'data:image/png;base64,abc123';
    assert.equal(resolveUrl(dataUri, 'https://example.com/'), dataUri);
  });

  test('returns empty string for empty input', () => {
    assert.equal(resolveUrl('', 'https://example.com/'), '');
  });

  test('returns empty string for null input', () => {
    assert.equal(resolveUrl(null, 'https://example.com/'), '');
  });

  test('returns javascript: URLs unchanged', () => {
    const js = 'javascript:void(0)';
    assert.equal(resolveUrl(js, 'https://example.com/'), js);
  });

  test('resolves protocol-relative URL', () => {
    const result = resolveUrl('//cdn.example.com/script.js', 'https://example.com/');
    assert.equal(result, 'https://cdn.example.com/script.js');
  });
});

// ═══════════════════════════════════════════════════════════════
// resolveSrcset
// ═══════════════════════════════════════════════════════════════
describe('resolveSrcset', () => {
  test('resolves multiple srcset entries', () => {
    const srcset = '/img/sm.png 480w, /img/lg.png 1024w';
    const result = resolveSrcset(srcset, 'https://example.com/');
    assert.equal(result, 'https://example.com/img/sm.png 480w, https://example.com/img/lg.png 1024w');
  });

  test('handles srcset with 2x descriptor', () => {
    const srcset = '/img/logo.png 1x, /img/logo@2x.png 2x';
    const result = resolveSrcset(srcset, 'https://example.com/');
    assert.equal(result, 'https://example.com/img/logo.png 1x, https://example.com/img/logo@2x.png 2x');
  });

  test('returns empty string for empty input', () => {
    assert.equal(resolveSrcset('', 'https://example.com/'), '');
  });

  test('handles single URL without descriptor', () => {
    const result = resolveSrcset('/img/image.png', 'https://example.com/');
    assert.equal(result, 'https://example.com/img/image.png');
  });
});

// ═══════════════════════════════════════════════════════════════
// escapeAttr
// ═══════════════════════════════════════════════════════════════
describe('escapeAttr', () => {
  test('escapes double quotes', () => {
    assert.equal(escapeAttr('say "hello"'), 'say &quot;hello&quot;');
  });

  test('escapes ampersands', () => {
    assert.equal(escapeAttr('a & b'), 'a &amp; b');
  });

  test('escapes angle brackets', () => {
    assert.equal(escapeAttr('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
  });

  test('passes through safe strings unchanged', () => {
    assert.equal(escapeAttr('hello world 123'), 'hello world 123');
  });
});

// ═══════════════════════════════════════════════════════════════
// escapeText
// ═══════════════════════════════════════════════════════════════
describe('escapeText', () => {
  test('escapes ampersands', () => {
    assert.equal(escapeText('a & b'), 'a &amp; b');
  });

  test('escapes < and > but not quotes', () => {
    assert.equal(escapeText('<p>text</p>'), '&lt;p&gt;text&lt;/p&gt;');
  });

  test('does not escape quotes (not needed in text nodes)', () => {
    assert.equal(escapeText('say "hello"'), 'say "hello"');
  });
});

// ═══════════════════════════════════════════════════════════════
// generateClassName
// ═══════════════════════════════════════════════════════════════
describe('generateClassName', () => {
  test('generates class name with _mb prefix', () => {
    assert.equal(generateClassName(0), '_mb0');
    assert.equal(generateClassName(100), '_mb100');
    assert.equal(generateClassName(1234), '_mb1234');
  });
});

// ═══════════════════════════════════════════════════════════════
// assembleCssFromStyleMap
// ═══════════════════════════════════════════════════════════════
describe('assembleCssFromStyleMap', () => {
  test('produces valid CSS rule blocks', () => {
    const styleMap = new Map([
      ['_mb0', { 'background-color': '#ff0000', 'font-size': '16px' }],
      ['_mb1', { 'display': 'flex', 'flex-direction': 'column' }],
    ]);
    const css = assembleCssFromStyleMap(styleMap);
    assert.ok(css.includes('._mb0 {'));
    assert.ok(css.includes('  background-color: #ff0000;'));
    assert.ok(css.includes('  font-size: 16px;'));
    assert.ok(css.includes('._mb1 {'));
    assert.ok(css.includes('  display: flex;'));
  });

  test('returns empty string for empty styleMap', () => {
    assert.equal(assembleCssFromStyleMap(new Map()), '');
  });

  test('skips entries with empty styles', () => {
    const styleMap = new Map([
      ['_mb0', {}],
    ]);
    const css = assembleCssFromStyleMap(styleMap);
    assert.equal(css, '');
  });
});
