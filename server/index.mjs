import { createServer } from 'node:http';
import { createApiHandler } from './api.mjs';
import { createStaticHandler } from './static.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
const handleApiRequest = createApiHandler();
const handleStaticRequest = createStaticHandler();

const server = createServer(async (request, response) => {
  const startedAt = performance.now();
  response.on('finish', () => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const duration = Math.round(performance.now() - startedAt);
    const requestId = response.getHeader('X-Request-Id') ?? '-';
    console.info(
      `${request.method ?? 'GET'} ${path} ${response.statusCode} ${duration}ms request_id=${requestId}`,
    );
  });

  try {
    const handled = await handleApiRequest(request, response);
    if (handled) return;

    const staticHandled = await handleStaticRequest(request, response);
    if (staticHandled) return;

    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({ error: 'Not found' }));
  } catch {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(port, host, () => {
  console.info(`Liangpei API listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.info(`${signal} received, shutting down`);
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
  setTimeout(() => process.exit(1), 8_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
