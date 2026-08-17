/**
 * Static file server for the built app.
 *
 * Zero dependencies on purpose: the whole app is a folder of static files, and
 * pulling a server framework in to hand them over would be more supply chain
 * than product. Railway injects PORT; everything else is fixed.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(process.env.STATIC_ROOT ?? 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolve a request path inside ROOT, or null if it escapes.
 * `resolve` collapses `..` before the prefix check, so traversal cannot slip
 * through by encoding or by stacking segments.
 */
function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = resolve(join(ROOT, decoded));
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null;
}

async function resolveFile(urlPath) {
  const candidate = safePath(urlPath);
  if (candidate) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return { file: candidate, info };
      if (info.isDirectory()) {
        const index = join(candidate, 'index.html');
        const indexInfo = await stat(index);
        if (indexInfo.isFile()) return { file: index, info: indexInfo };
      }
    } catch {
      /* fall through */
    }
  }

  // A request for something with a file extension is an asset, not navigation.
  // Falling those back to index.html would answer a missing .js with HTML and
  // turn a broken deploy into a baffling MIME error instead of a plain 404.
  if (/\.[a-z0-9]+$/i.test(urlPath)) return null;

  // Single-page app: unknown navigation paths render the app rather than 404.
  const fallback = join(ROOT, 'index.html');
  try {
    return { file: fallback, info: await stat(fallback) };
  } catch {
    return null;
  }
}

function cacheControl(file) {
  // Vite content-hashes everything under /assets, so those are safe to pin
  // forever. index.html must never be cached or a deploy will not be picked up.
  return file.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }

  const urlPath = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).pathname;
  const found = await resolveFile(urlPath);

  if (!found) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found — did the build run?');
  }

  const { file, info } = found;
  const etag = `W/"${info.size}-${Number(info.mtimeMs).toString(36)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(file) });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cacheControl(file),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });

  if (req.method === 'HEAD') return res.end();

  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`svidpool serving ${ROOT} on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
