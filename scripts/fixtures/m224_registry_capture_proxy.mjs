#!/usr/bin/env node
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const targetBase = process.env.M224_PROXY_TARGET;
const listenPort = Number(process.env.M224_PROXY_PORT || 0);
const outputPath = process.env.M224_PROXY_LOG;

if (!targetBase || !outputPath || !listenPort) {
  console.error('m224 proxy requires M224_PROXY_TARGET, M224_PROXY_PORT, and M224_PROXY_LOG');
  process.exit(2);
}

const ALLOWED_GET_PATTERNS = [
  /^\/api\/v1\/kernel\/agents(?:\?.*)?$/,
  /^\/api\/v1\/kernel\/agents\/[^/]+\/versions\/[1-9][0-9]*$/,
  /^\/api\/v1\/kernel\/tool-definitions(?:\?.*)?$/,
  /^\/api\/v1\/kernel\/tool-definitions\/[^/]+\/versions\/[1-9][0-9]*$/,
  /^\/api\/v1\/kernel\/tool-enablement$/,
  /^\/api\/v1\/kernel\/tool-enablement\/[^/]+\/versions\/[1-9][0-9]*$/,
  /^\/api\/v1\/kernel\/connector-types(?:\?.*)?$/,
  /^\/api\/v1\/kernel\/connector-types\/[^/]+\/versions\/[1-9][0-9]*$/,
  /^\/api\/v1\/kernel\/connector-bindings(?:\?.*)?$/,
  /^\/api\/v1\/kernel\/connector-bindings\/[^/]+\/versions\/[1-9][0-9]*$/,
];

const entries = [];

function persist() {
  writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function sanitizePath(rawUrl) {
  const parsed = new URL(rawUrl, targetBase);
  const safe = new URL(parsed.pathname, targetBase);
  const limit = parsed.searchParams.get('limit');
  if (limit) {
    safe.searchParams.set('limit', limit);
  }
  if (parsed.searchParams.has('cursor=')) {
    safe.searchParams.set('cursor', '[redacted]');
  }
  if (parsed.searchParams.has('cursor')) {
    safe.searchParams.set('cursor', '[redacted]');
    safe.searchParams.delete('cursor');
  }
  return `${safe.pathname}${safe.search}`;
}

function assertAllowed(method, path) {
  return method === 'GET' && ALLOWED_GET_PATTERNS.some(pattern => pattern.test(path));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', targetBase);
  const safePath = sanitizePath(req.url ?? '/');
  if (!assertAllowed(req.method ?? '', requestUrl.pathname + requestUrl.search)) {
    entries.push({
      method: req.method ?? 'UNKNOWN',
      path: safePath,
      statusCode: 405,
      blocked: true,
    });
    persist();
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: { code: 'proxy_disallowed', message: 'request not allowed' } }));
    return;
  }

  const forwardHeaders = { ...req.headers };
  // Forward auth unchanged to the disposable Core, but never retain
  // authorization values in the artifact log.
  delete forwardHeaders.host;
  delete forwardHeaders['content-length'];

  const upstream = await fetch(requestUrl, {
    method: req.method,
    headers: forwardHeaders,
  });
  entries.push({
    method: req.method ?? 'GET',
    path: safePath,
    statusCode: upstream.status,
  });
  persist();

  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
});

server.listen(listenPort, '127.0.0.1', () => {
  persist();
  console.log(`m224-registry-proxy listening on 127.0.0.1:${listenPort}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    persist();
    server.close(() => process.exit(0));
  });
}
