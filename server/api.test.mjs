import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApiHandler } from './api.mjs';

const validMatch = {
  match_id: 'test-match',
  match_status: 'MATCH_STATUS_MATCHED',
  message_count: 0,
  user_a: {
    nickname: 'A',
    gender: 'female',
    profile: '# A',
    memories_self: [],
    memories_ideal: [],
  },
  user_b: {
    nickname: 'B',
    gender: 'male',
    profile: '# B',
    memories_self: [],
    memories_ideal: [],
  },
  messages: [],
};

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('health reports configured service without exposing the token', async () => {
  await withServer(createApiHandler({ token: 'server-secret' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(JSON.stringify(body).includes('server-secret'), false);
  });
});

test('match endpoint refuses to run without a server-side token', async () => {
  await withServer(createApiHandler({ token: '' }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/match`);
    assert.equal(response.status, 503);
  });
});

test('match endpoint validates and returns the upstream payload', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify(validMatch), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  await withServer(createApiHandler({ token: 'secret', fetchImpl }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/match`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-data-source'), 'intellimatch');
    assert.deepEqual(await response.json(), validMatch);
  });
});

test('match endpoint rejects malformed upstream data', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 });

  await withServer(createApiHandler({ token: 'secret', fetchImpl }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/match`);
    assert.equal(response.status, 502);
  });
});

test('match endpoint rate limits repeated requests by client address', async () => {
  const fetchImpl = async () => new Response(JSON.stringify(validMatch), { status: 200 });

  await withServer(
    createApiHandler({ token: 'secret', fetchImpl, rateLimit: 1 }),
    async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/api/match`)).status, 200);
      const response = await fetch(`${baseUrl}/api/match`);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('ratelimit-remaining'), '0');
      assert.ok(Number(response.headers.get('retry-after')) > 0);
    },
  );
});
