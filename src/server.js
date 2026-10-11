import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECURRENCES } from './recurrence.js';
import { AppError, COMPLETION_STATUSES, INSTANCE_STATUSES } from './tasks.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY_BYTES = 100_000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function route(method, pattern, handler, status = 200) {
  const keys = [];
  const source = pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, regex: new RegExp(`^${source}$`), keys, handler, status };
}

export function buildRoutes(service) {
  return [
    route('GET', '/api/meta', () => ({
      recurrences: RECURRENCES,
      instanceStatuses: INSTANCE_STATUSES,
      completionStatuses: COMPLETION_STATUSES,
    })),

    route('GET', '/api/staff', () => service.listStaff()),
    route('POST', '/api/staff', (_p, body) => service.createStaff(body), 201),

    route('GET', '/api/templates', () => service.listTemplates()),
    route('POST', '/api/templates', (_p, body) => service.createTemplate(body), 201),
    route('PATCH', '/api/templates/:id', (p, body) => service.updateTemplate(p.id, body)),
    route('DELETE', '/api/templates/:id', (p) => service.deleteTemplate(p.id), 204),

    route('GET', '/api/schedules', () => service.listSchedules()),
    route('POST', '/api/schedules', (_p, body) => service.createSchedule(body), 201),
    route('PATCH', '/api/schedules/:id', (p, body) => service.updateSchedule(p.id, body)),
    route('DELETE', '/api/schedules/:id', (p) => service.deleteSchedule(p.id), 204),

    route('GET', '/api/instances', (_p, _b, query) => service.listInstances(query)),
    route('PATCH', '/api/instances/:id', (p, body) => service.updateInstance(p.id, body)),
  ];
}

export function createServer({ service }) {
  const routes = buildRoutes(service);

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, routes);
      } else {
        await serveStatic(req.method, url.pathname, res);
      }
    } catch (error) {
      if (error instanceof AppError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error(error);
        sendJson(res, 500, { error: 'Something went wrong' });
      }
    }
  });
}

async function handleApi(req, res, url, routes) {
  const candidates = routes.filter((entry) => entry.regex.test(url.pathname));
  if (!candidates.length) throw new AppError(404, 'Not found');

  const entry = candidates.find((candidate) => candidate.method === req.method);
  if (!entry) throw new AppError(405, 'Method not allowed');

  const match = entry.regex.exec(url.pathname);
  const params = Object.fromEntries(entry.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
  const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : undefined;
  const query = Object.fromEntries(url.searchParams);

  const result = await entry.handler(params, body, query);
  if (entry.status === 204) {
    res.writeHead(204).end();
    return;
  }
  sendJson(res, entry.status, result);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        resolve(parsed);
      } catch {
        reject(new AppError(400, 'Request body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(method, pathname, res) {
  if (method !== 'GET' && method !== 'HEAD') throw new AppError(405, 'Method not allowed');

  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) throw new AppError(403, 'Forbidden');

  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    throw new AppError(404, 'Not found');
  }
  res.writeHead(200, { 'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
  res.end(method === 'HEAD' ? undefined : data);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
