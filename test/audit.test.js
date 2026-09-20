import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { audit, findChrome } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// Port 0 lets the OS pick a free one: a hard-coded port turns any unrelated
// local server into a confusing test failure.
let server;
let PORT;

before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.split('?')[0].replace(/^\//, '') || 'clean.html';
    let body;
    try {
      body = readFileSync(join(here, 'fixtures', name));
    } catch {
      if (!res.headersSent) res.writeHead(404);
      return res.end('nope');
    }
    // Chrome drops connections when it navigates away mid-request. Writing to
    // a closed socket would throw ERR_HTTP_HEADERS_SENT and fail the run for
    // a reason that has nothing to do with the code under test.
    if (res.writableEnded || res.headersSent) return;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  });
  server.on('clientError', (_e, socket) => socket.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
});

after(() => server?.close());

const url = (f) => `http://127.0.0.1:${PORT}/${f}`;
const skip = !findChrome();
const opts = { widths: [{ name: '320', width: 320, height: 800 }] };

test('finds every defect on a broken page', { skip }, async () => {
  const { issues } = await audit([url('broken.html')], opts);
  const types = new Set(issues.map((i) => i.type));

  // This is the guard on the guard: a detector that detects nothing passes
  // every test that only checks it does not crash.
  assert.ok(types.has('overflow'), 'should report the 900px div');
  assert.ok(types.has('tap-target'), 'should report the 16px button');
  assert.ok(types.has('small-text'), 'should report the 8px text');
  assert.ok(types.has('unsized-image'), 'should report the image without dimensions');
  assert.ok(types.has('no-viewport-meta'), 'should report the missing viewport meta');
});

test('reports nothing on a clean page', { skip }, async () => {
  const { issues } = await audit([url('clean.html')], opts);
  assert.deepEqual(issues, [], `expected no issues, got: ${issues.map((i) => i.message).join(' | ')}`);
});

test('respects opt-in horizontal scrolling and prose links', { skip }, async () => {
  const { issues } = await audit([url('broken.html')], opts);
  const text = issues.map((i) => i.message).join(' ');
  assert.ok(!text.includes('Allowed'), 'an overflow-x:auto child is deliberate');
  assert.ok(!text.includes('inline link in prose'), 'WCAG excepts targets inside a block of text');
});

test('merges a defect reported at several widths', { skip }, async () => {
  const { issues } = await audit([url('broken.html')], {
    widths: [
      { name: '320', width: 320, height: 800 },
      { name: '390', width: 390, height: 844 },
    ],
  });
  const overflow = issues.filter((i) => i.type === 'overflow');
  assert.equal(overflow.length, 1, 'one defect, one line');
  assert.deepEqual(overflow[0].widths, [320, 390]);
});

test('honours the ignore list', { skip }, async () => {
  const { issues } = await audit([url('broken.html')], { ...opts, ignore: ['button'] });
  assert.ok(!issues.some((i) => i.type === 'tap-target'), 'ignored selectors are not reported');
});

test('refuses an empty URL list', async () => {
  await assert.rejects(() => audit([]), /at least one URL/);
});
