import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMIT_JSON_DIR = path.resolve(__dirname, '../commit_crawler/json');

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseRequestedFile(urlValue) {
  const url = new URL(urlValue, 'http://localhost');
  const value = url.searchParams.get('file');
  if (!value) {
    return null;
  }
  if (path.basename(value) !== value) {
    return null;
  }
  if (!value.endsWith('.json')) {
    return null;
  }
  return value;
}

async function listCommitJsonFiles() {
  let directoryEntries = [];
  try {
    directoryEntries = await readdir(COMMIT_JSON_DIR, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of directoryEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const fullPath = path.join(COMMIT_JSON_DIR, entry.name);
    const fileStat = await stat(fullPath);
    files.push({
      name: entry.name,
      sizeBytes: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
    });
  }

  files.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs || a.name.localeCompare(b.name));
  return files;
}

async function readCommitJsonFile(fileName) {
  const fullPath = path.join(COMMIT_JSON_DIR, fileName);
  return readFile(fullPath, 'utf-8');
}

function attachCommitJsonApi(server) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url || req.method !== 'GET') {
      next();
      return;
    }

    try {
      const parsed = new URL(req.url, 'http://localhost');

      if (parsed.pathname === '/api/commit-logs') {
        const files = await listCommitJsonFiles();
        jsonResponse(res, 200, { files });
        return;
      }

      if (parsed.pathname === '/api/commit-log') {
        const fileName = parseRequestedFile(req.url);
        if (!fileName) {
          jsonResponse(res, 400, { error: 'invalid file parameter' });
          return;
        }
        const text = await readCommitJsonFile(fileName);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(text);
        return;
      }

      next();
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        jsonResponse(res, 404, { error: 'file not found' });
        return;
      }
      jsonResponse(res, 500, { error: 'internal server error' });
    }
  });
}

function commitJsonApiPlugin() {
  return {
    name: 'commit-json-api',
    configureServer(server) {
      attachCommitJsonApi(server);
    },
    configurePreviewServer(server) {
      attachCommitJsonApi(server);
    },
  };
}

export default defineConfig({
  plugins: [react(), commitJsonApiPlugin()],
});
