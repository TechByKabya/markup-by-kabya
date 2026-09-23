import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBridgeServer } from '../src/server/index.js';

const TEST_STORAGE = path.resolve(process.cwd(), '.antigravity_test');
const TEST_PORT = 3055;

test('Bridge Server API & Queue Integration', async (t) => {
  // Clean up any previous test storage
  if (fs.existsSync(TEST_STORAGE)) {
    fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
  }

  const bridge = createBridgeServer({
    port: TEST_PORT,
    host: '127.0.0.1',
    storageDir: TEST_STORAGE
  });

  await bridge.start();

  t.after(async () => {
    await bridge.close();
    if (fs.existsSync(TEST_STORAGE)) {
      fs.rmSync(TEST_STORAGE, { recursive: true, force: true });
    }
  });

  let createdId = null;

  await t.test('GET /client.js serves valid JavaScript', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/client.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/javascript/);
    const text = await res.text();
    assert.ok(text.includes('__ANTIGRAVITY_BRIDGE_INITIALIZED__'));
  });

  await t.test('GET /health returns server health and queue stats', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'ok');
    assert.equal(typeof json.uptime, 'number');
    assert.equal(json.totalCount, 0);
  });

  await t.test('POST /api/feedback queues element feedback and persists to file', async () => {
    const payload = {
      url: 'http://localhost:3000/dashboard',
      selector: '#main-content > div.card:nth-child(2) > button.btn-primary',
      outerHTML: '<button class="btn-primary">Checkout Now</button>',
      computedStyles: {
        'display': 'flex',
        'background-color': 'rgb(79, 70, 229)',
        'color': 'rgb(255, 255, 255)',
        'font-size': '14px',
        'padding': '10px 20px',
        'width': '180px',
        'height': '40px'
      },
      reactContext: {
        componentName: '<CheckoutButton>',
        hierarchy: ['<App>', '<CartModal>', '<CheckoutButton>'],
        source: {
          file: 'src/components/CheckoutButton.tsx',
          line: 42,
          column: 5
        },
        props: { variant: 'primary', disabled: false }
      },
      userNotes: 'Make this button emerald green, add a subtle hover shadow, and change text to Complete Purchase',
      tag: 'styling'
    };

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.ok(json.id.startsWith('fb_'));
    assert.equal(json.status, 'pending');
    assert.equal(json.selector, payload.selector);
    assert.equal(json.reactContext.componentName, '<CheckoutButton>');
    assert.equal(json.userNotes, payload.userNotes);

    createdId = json.id;

    // Verify file persistence
    const queueFile = path.join(TEST_STORAGE, 'ui_feedback_queue.json');
    assert.ok(fs.existsSync(queueFile));
    const rawFile = fs.readFileSync(queueFile, 'utf8');
    const saved = JSON.parse(rawFile);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, createdId);
  });

  await t.test('GET /api/feedback lists queued items', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.count, 1);
    assert.equal(json.items[0].id, createdId);
  });

  await t.test('GET /api/feedback/latest returns newest pending item', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback/latest`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.latest);
    assert.equal(json.latest.id, createdId);
  });

  await t.test('GET /api/feedback/:id retrieves specific item', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback/${createdId}`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.id, createdId);
    assert.equal(json.reactContext.source.file, 'src/components/CheckoutButton.tsx');
  });

  await t.test('PATCH /api/feedback/:id updates status and resolution notes', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback/${createdId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'resolved',
        resolutionNotes: 'Updated CheckoutButton style with emerald background and Complete Purchase label.'
      })
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, 'resolved');
    assert.ok(json.resolvedAt);
    assert.ok(json.resolutionNotes.includes('emerald'));
  });

  await t.test('POST /api/feedback/clear clears queue', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'all' })
    });

    assert.equal(res.status, 200);
    const checkRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/feedback`);
    const checkJson = await checkRes.json();
    assert.equal(checkJson.count, 0);
  });
});
