// GitHub Contents API layer: the repo is the source of truth for the catalog.
// Reads for the live catalog go through the Pages-served file (no auth);
// writes use a fine-grained PAT with contents read/write on this one repo.

import { mergeCatalogs } from '../domain/catalog.js';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
export const CATALOG_PATH = 'data/catalog.json';
export const IMAGE_DIR = 'data/images';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

// Detect owner/repo when the app is served from GitHub Pages.
export function detectRepo() {
  try {
    const { hostname, pathname } = window.location;
    if (!hostname.endsWith('.github.io')) return null;
    const owner = hostname.split('.')[0];
    const segs = pathname.split('/').filter(Boolean);
    let repo = segs[0];
    if (!repo || repo === 'index.html') repo = `${owner}.github.io`;
    return { owner, repo, branch: 'main' };
  } catch {
    return null;
  }
}

function authHeaders(settings) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
  return headers;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function requireRepo(settings) {
  if (!settings.token || !settings.owner || !settings.repo) {
    throw new GitHubError(
      400,
      'GitHub is not configured — add a token, owner and repository in Settings.'
    );
  }
}

async function errorFrom(response) {
  let message = `GitHub API error (${response.status})`;
  try {
    const body = await response.json();
    if (body?.message) message = body.message;
  } catch {
    /* keep default */
  }
  if (response.status === 401) message = 'Invalid or expired token — check Settings.';
  if (response.status === 403) message = `Access denied or rate limited: ${message}`;
  return new GitHubError(response.status, message);
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(String(b64).replace(/[\r\n]/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Fetch a file from the repo. Returns { exists, sha, text }.
export async function getFile(settings, path) {
  requireRepo(settings);
  const url = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(
    settings.repo
  )}/contents/${encodePath(path)}?ref=${encodeURIComponent(settings.branch || 'main')}`;
  const response = await fetch(url, { headers: authHeaders(settings) });
  if (response.status === 404) return { exists: false, sha: null, text: null };
  if (!response.ok) throw await errorFrom(response);
  const body = await response.json();
  if (body.type && body.type !== 'file') {
    throw new GitHubError(400, `${path} exists but is not a regular file.`);
  }
  if (body.encoding === 'base64' && typeof body.content === 'string') {
    return { exists: true, sha: body.sha, text: fromBase64(body.content) };
  }
  throw new GitHubError(
    413,
    `${path} could not be read through the contents API (file too large?).`
  );
}

// Write a file; `sha` is required when the file already exists.
export async function putFileRaw(settings, path, base64, message, sha) {
  requireRepo(settings);
  const url = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(
    settings.repo
  )}/contents/${encodePath(path)}`;
  const payload = {
    message,
    content: base64,
    branch: settings.branch || 'main',
  };
  if (sha) payload.sha = sha;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(settings), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export function putFile(settings, path, text, message, sha) {
  return putFileRaw(settings, path, toBase64(text), message, sha);
}

// Read the catalog published with the site (served by Pages, no auth, no CORS issues).
export async function fetchPublishedCatalog() {
  const base =
    typeof document !== 'undefined' && document.baseURI
      ? document.baseURI
      : typeof location !== 'undefined'
        ? location.href
        : 'http://localhost/';
  const url = new URL('data/catalog.json', base);
  url.searchParams.set('t', String(Date.now()));
  const response = await fetch(url.href, { cache: 'no-cache' });
  if (!response.ok) return null;
  const data = await response.json();
  return data && Array.isArray(data.items) ? data : null;
}

// Merge local changes with whatever is on the server, then push.
// Conflict-safe: always pushes with the current server sha; on a clash it
// refetches, re-merges (so the other device's records survive) and retries once.
export async function syncCatalog(settings, localCatalog, baseUpdated) {
  let server = await getFile(settings, CATALOG_PATH);

  if (!server.exists) {
    const first = { ...localCatalog, updated: new Date().toISOString() };
    await putFile(settings, CATALOG_PATH, JSON.stringify(first, null, 2), 'Add grocery catalog');
    return first;
  }

  // Build the payload for a given server snapshot. When the server moved since
  // our base, union-merge; when the base is omitted/stale, merge too.
  const buildOutgoing = (serverFile, local, base) => {
    let remote = null;
    try {
      remote = JSON.parse(serverFile.text);
    } catch {
      remote = null; // unreadable server copy → local wins
    }
    let outgoing;
    if (remote && Array.isArray(remote.items) && base !== undefined && remote.updated === base) {
      outgoing = { ...local };
    } else if (remote && Array.isArray(remote.items)) {
      outgoing = mergeCatalogs(remote, local);
    } else {
      outgoing = { ...local };
    }
    outgoing.updated = new Date().toISOString();
    return outgoing;
  };

  let outgoing = buildOutgoing(server, localCatalog, baseUpdated);
  const put = (sha) =>
    putFile(
      settings,
      CATALOG_PATH,
      JSON.stringify(outgoing, null, 2),
      `Update grocery catalog (${outgoing.items.length} items)`,
      sha
    );

  try {
    await put(server.sha);
  } catch (err) {
    const conflict = err instanceof GitHubError && (err.status === 409 || err.status === 422);
    if (!conflict) throw err;
    server = await getFile(settings, CATALOG_PATH); // refresh sha (and content)
    if (server.exists) {
      outgoing = buildOutgoing(server, outgoing); // always merge the fresh remote copy
      await put(server.sha);
    } else {
      await put(undefined); // file vanished — recreate it
    }
  }
  return outgoing;
}

// Upload a compressed image (data URL) and return its repo path.
// Content-addressed by hash, so re-uploads are skipped.
export async function uploadImage(settings, dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl));
  if (!match) throw new Error('Invalid image data');
  const mime = match[1];
  const base64 = match[2];
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

  let hash = null;
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(base64));
    hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    hash = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  const path = `${IMAGE_DIR}/${hash}.${ext}`;
  const existing = await getFile(settings, path);
  if (existing.exists) return path;

  await putFileRaw(settings, path, base64, `Add product image ${hash}.${ext}`);
  return path;
}

// Lightweight connectivity check used by Settings.
export async function testConnection(settings) {
  requireRepo(settings);
  const url = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(
    settings.repo
  )}`;
  const response = await fetch(url, { headers: authHeaders(settings) });
  if (!response.ok) throw await errorFrom(response);
  const repo = await response.json();

  let catalogNote = 'catalog file not in repo yet (it will be created on first sync)';
  try {
    const file = await getFile(settings, CATALOG_PATH);
    if (file.exists) catalogNote = 'catalog file found';
  } catch {
    /* non-fatal */
  }

  const branchMismatch =
    repo.default_branch && repo.default_branch !== (settings.branch || 'main')
      ? ` — note: repo default branch is "${repo.default_branch}" but settings use "${settings.branch}"`
      : '';

  return {
    ok: true,
    message: `Connected to ${repo.full_name} (${repo.default_branch}); ${catalogNote}${branchMismatch}`,
  };
}
