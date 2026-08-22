import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  );
}

function sendText(response, statusCode, message) {
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(message);
}

async function fileInfo(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

export function createStaticHandler({ root = process.env.STATIC_DIR ?? 'dist' } = {}) {
  const absoluteRoot = resolve(root);
  const rootPrefix = `${absoluteRoot}${sep}`;

  return async function handleStaticRequest(request, response) {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) return false;

    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return true;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendText(response, 400, 'Bad request');
      return true;
    }

    let filePath = resolve(absoluteRoot, `.${pathname}`);
    if (filePath !== absoluteRoot && !filePath.startsWith(rootPrefix)) {
      sendText(response, 403, 'Forbidden');
      return true;
    }

    let info = await fileInfo(filePath);
    if (!info && (pathname.startsWith('/assets/') || extname(pathname))) {
      sendText(response, 404, 'Not found');
      return true;
    }

    if (!info) {
      filePath = resolve(absoluteRoot, 'index.html');
      info = await fileInfo(filePath);
    }

    if (!info) {
      sendText(response, 503, 'Frontend is not available');
      return true;
    }

    const etag = `W/\"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}\"`;
    setSecurityHeaders(response);
    response.setHeader('ETag', etag);
    response.setHeader('Last-Modified', info.mtime.toUTCString());

    if (request.headers['if-none-match'] === etag) {
      response.statusCode = 304;
      response.end();
      return true;
    }

    const isAsset = filePath.startsWith(resolve(absoluteRoot, 'assets') + sep);
    response.statusCode = 200;
    response.setHeader(
      'Content-Type',
      CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    );
    response.setHeader('Content-Length', String(info.size));
    response.setHeader(
      'Cache-Control',
      isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    );

    if (method === 'HEAD') {
      response.end();
      return true;
    }

    await new Promise((resolveStream) => {
      const stream = createReadStream(filePath);
      stream.on('error', () => {
        if (!response.headersSent) sendText(response, 500, 'Unable to read frontend asset');
        else response.destroy();
        resolveStream();
      });
      response.on('finish', resolveStream);
      response.on('close', resolveStream);
      stream.pipe(response);
    });
    return true;
  };
}
