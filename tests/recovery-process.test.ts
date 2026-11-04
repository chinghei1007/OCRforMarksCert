import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const port = 4199;
const baseUrl = `http://127.0.0.1:${port}`;
const dbPath = resolve(process.cwd(), 'data/recovery-test.db');
const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/documents`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 80));
  }
  throw new Error('Recovery test server did not start');
}

function startServer() {
  const child = spawn(tsx, ['server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
}

test('pending processing attempts resume after a server restart without creating a new attempt', { timeout: 25_000 }, async () => {
  for (const suffix of ['', '-shm', '-wal']) await rm(`${dbPath}${suffix}`, { force: true });
  let server = startServer();
  let uploadedPath = '';
  try {
    await waitForServer();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const form = new FormData();
    const pdfBytes = await pdf.save();
    form.append('files', new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), 'restart-result.pdf');
    const upload = await fetch(`${baseUrl}/api/documents/upload`, { method: 'POST', headers: { 'x-actor-id': 'user:recovery.test' }, body: form });
    assert.equal(upload.status, 201);
    const { documentIds } = await upload.json() as { documentIds: string[] };
    const documentId = documentIds[0];
    const before = await (await fetch(`${baseUrl}/api/documents/${documentId}`)).json() as { sourceUrl: string };
    uploadedPath = resolve(process.cwd(), before.sourceUrl.replace(/^\//, ''));
    const processResponse = await fetch(`${baseUrl}/api/documents/${documentId}/process`, { method: 'POST', headers: { 'x-actor-id': 'user:recovery.test' } });
    assert.equal(processResponse.status, 202);
    await stopServer(server);

    server = startServer();
    await waitForServer();
    const deadline = Date.now() + 8_000;
    let detail: { status: string; attemptNumber: number; attemptStatus: string } | undefined;
    while (Date.now() < deadline) {
      detail = await (await fetch(`${baseUrl}/api/documents/${documentId}`)).json();
      if (detail?.status === 'draft' || detail?.status === 'not_started') break;
      await new Promise(resolveWait => setTimeout(resolveWait, 120));
    }
    assert.equal(detail?.status, 'draft');
    assert.equal(detail?.attemptNumber, 1);
    assert.equal(detail?.attemptStatus, 'succeeded');
  } finally {
    await stopServer(server);
    if (uploadedPath) await rm(uploadedPath, { force: true });
    for (const suffix of ['', '-shm', '-wal']) await rm(`${dbPath}${suffix}`, { force: true });
  }
});
