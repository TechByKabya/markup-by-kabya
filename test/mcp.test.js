import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMcpServer } from '../src/mcp/server.js';
import { FeedbackQueue } from '../src/server/queue.js';

const TEST_STORAGE = path.resolve(process.cwd(), '.antigravity_mcp_test');

test('MCP Server Tools & Queue Sync', async (t) => {
  if (fs.existsSync(TEST_STORAGE)) {
    fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
  }

  const mcp = createMcpServer({ storageDir: TEST_STORAGE });
  const queue = new FeedbackQueue(TEST_STORAGE);

  t.after(() => {
    if (fs.existsSync(TEST_STORAGE)) {
      fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
    }
  });

  let testItem = null;

  await t.test('Queue population and list_ui_feedback tool', async () => {
    testItem = queue.addFeedback({
      url: 'http://localhost:3000/shop',
      selector: '#product-card-1 > button.buy-now',
      outerHTML: '<button class="buy-now">Buy $29</button>',
      computedStyles: {
        'display': 'block',
        'color': '#ffffff',
        'background-color': '#4f46e5'
      },
      reactContext: {
        componentName: '<ProductCard>',
        hierarchy: ['<App>', '<ProductGrid>', '<ProductCard>'],
        source: {
          file: 'src/components/ProductCard.tsx',
          line: 28,
          column: 4
        }
      },
      userNotes: 'Change button text to Purchase License and add an icon',
      tag: 'styling'
    });

    assert.ok(testItem.id);

    // Call tool directly through registered tools map
    // McpServer stores registered tools in _registeredTools or handles via internal registry
    const tool = mcp.server._registeredTools?.['list_ui_feedback'];
    assert.ok(tool, 'list_ui_feedback tool should be registered');

    const result = await tool.handler({ status: 'pending', limit: 10 });
    assert.ok(result.content);
    assert.equal(result.content[0].type, 'text');
    assert.ok(result.content[0].text.includes(testItem.id));
    assert.ok(result.content[0].text.includes('<ProductCard>'));
    assert.ok(result.content[0].text.includes('Purchase License'));
  });

  await t.test('get_ui_feedback tool returns deep context', async () => {
    const tool = mcp.server._registeredTools?.['get_ui_feedback'];
    assert.ok(tool, 'get_ui_feedback tool should be registered');

    const result = await tool.handler({ id: testItem.id });
    assert.ok(result.content);
    const text = result.content[0].text;
    assert.ok(text.includes('src/components/ProductCard.tsx'));
    assert.ok(text.includes('Line**: `28`'));
    assert.ok(text.includes('#product-card-1 > button.buy-now'));
    assert.ok(text.includes('Purchase License and add an icon'));
    assert.ok(text.includes('<button class="buy-now">Buy $29</button>'));
  });

  await t.test('resolve_ui_feedback marks feedback resolved', async () => {
    const tool = mcp.server._registeredTools?.['resolve_ui_feedback'];
    assert.ok(tool, 'resolve_ui_feedback tool should be registered');

    const result = await tool.handler({
      id: testItem.id,
      resolutionNotes: 'Updated text to Purchase License with SVG cart icon.',
      status: 'resolved'
    });

    assert.ok(result.content[0].text.includes('RESOLVED'));

    // Check disk queue
    queue.init();
    const updated = queue.getFeedback(testItem.id);
    assert.equal(updated.status, 'resolved');
    assert.ok(updated.resolutionNotes.includes('Purchase License'));
  });

  await t.test('clear_ui_feedback removes resolved items', async () => {
    const tool = mcp.server._registeredTools?.['clear_ui_feedback'];
    assert.ok(tool, 'clear_ui_feedback tool should be registered');

    const result = await tool.handler({ status: 'resolved' });
    assert.ok(result.content[0].text.includes('Cleared'));

    queue.init();
    const items = queue.listFeedback({ status: 'all' });
    assert.equal(items.length, 0);
  });
});
