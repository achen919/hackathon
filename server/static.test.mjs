import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStaticHandler } from './static.mjs';

async function withStaticServer(run) {
  const root = await mkdtemp(join(tmpdir(), 'liangpei-static-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><h1>Liangpei</h1>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("ready")');

  const handler = createStaticHandler({ root });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true });
  }
}

test('serves the SPA with security and no-cache headers', async () => {
  await withStaticServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Liangpei/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  });
});

test('serves hashed assets with long-lived immutable caching', async () => {
  await withStaticServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(response.headers.get('cache-control') ?? '', /immutable/);
  });
});

test('uses index.html as the SPA fallback but not for missing assets', async () => {
  await withStaticServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/profiles/a`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/assets/missing.js`)).status, 404);
  });
});
