const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = process.env.CLOSE_CIRCLE_DATA_FILE || path.join(DATA_DIR, 'circle.json');
const PORT = Number(process.env.PORT || 4173);
const EMPTY_STATE = { posts: [], events: [], ideas: [] };
const TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let writeQueue = Promise.resolve();

async function readState() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return structuredClone(EMPTY_STATE);
  }
}

function mergeRecords(existing = [], incoming = [], key = 'id') {
  const merged = new Map(existing.map(item => [String(item[key]), item]));
  for (const item of incoming) {
    const id = String(item[key]);
    const prior = merged.get(id);
    if (!prior) merged.set(id, item);
    else {
      const next = { ...prior, ...item };
      if (prior.votes || item.votes) next.votes = { ...prior.votes, ...item.votes };
      if (Array.isArray(prior.voters) || Array.isArray(item.voters)) {
        next.voters = [...new Set([...(prior.voters || []), ...(item.voters || [])])];
        next.votes = next.voters.length;
      }
      merged.set(id, next);
    }
  }
  return [...merged.values()].sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)));
}

function mergeState(existing, incoming) {
  return {
    posts: mergeRecords(existing.posts, incoming.posts),
    events: mergeRecords(existing.events, incoming.events),
    ideas: mergeRecords(existing.ideas, incoming.ideas),
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function saveIncoming(incoming) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const existing = await readState();
    const state = mergeState(existing, incoming);
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const temporary = `${DATA_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state), 'utf8');
    await fs.rename(temporary, DATA_FILE);
    return state;
  });
  return writeQueue;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(ROOT, `.${pathname}`);
  if (!target.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  if (request.url === '/api/state' && request.method === 'GET') {
    try {
      const state = await readState();
      sendJson(response, 200, { state, empty: !state.posts.length && !state.events.length && !state.ideas.length });
    } catch (error) {
      sendJson(response, 500, { error: 'Could not read the shared circle.' });
      console.error(error);
    }
    return;
  }

  if (request.url === '/api/state' && request.method === 'POST') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 48 * 1024 * 1024) request.destroy();
    });
    request.on('end', async () => {
      try {
        const incoming = JSON.parse(body);
        const state = await saveIncoming({
          posts: Array.isArray(incoming.posts) ? incoming.posts : [],
          events: Array.isArray(incoming.events) ? incoming.events : [],
          ideas: Array.isArray(incoming.ideas) ? incoming.ideas : [],
        });
        sendJson(response, 200, { state });
      } catch (error) {
        sendJson(response, 400, { error: 'Could not save the shared circle.' });
        console.error(error);
      }
    });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end('Method not allowed');
    return;
  }
  await serveStatic(request, response);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Close Circle is running at http://localhost:${PORT}`);
  console.log('On the same Wi-Fi, friends can open this computer’s local network address on the same port.');
});
