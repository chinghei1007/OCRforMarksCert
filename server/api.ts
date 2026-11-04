import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import type { AppDatabase } from './db';
import { addEvent, withTransaction } from './db';
import { assertTransition, type DocumentStatus } from './state-machine';
import { extractDocument } from './model-adapter';
import type { ExtractedField } from '../src/types';

const uploadDir = resolve(process.cwd(), 'uploads');
mkdirSync(uploadDir, { recursive: true });

const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024, files: 50 },
  fileFilter: (_request, file, callback) => callback(null, acceptedTypes.has(file.mimetype)),
});

const actorFrom = (request: Request) => String(request.header('x-actor-id') || 'user:demo.reviewer');
const requestIdFrom = (request: Request) => String(request.header('x-request-id') || randomUUID());

type DocumentRow = {
  id: string; status: DocumentStatus; filename: string; storage_key: string; mime_type: string;
  page_count: number; document_type: string; current_revision_id: string | null; active_attempt_id: string | null;
  created_at: string; created_by: string; updated_at: string; updated_by: string; version: number;
};

function serializeDocument(db: AppDatabase, row: DocumentRow) {
  const attempt = row.active_attempt_id
    ? db.prepare('SELECT attempt_number, status FROM processing_attempts WHERE id=?').get(row.active_attempt_id) as { attempt_number: number; status: string } | undefined
    : undefined;
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    pageCount: row.page_count,
    status: row.status,
    documentType: row.document_type,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: row.version,
    attemptNumber: attempt?.attempt_number ?? null,
    attemptStatus: attempt?.status ?? null,
  };
}

function getDocumentRow(db: AppDatabase, id: string) {
  return db.prepare('SELECT * FROM documents WHERE id=?').get(id) as DocumentRow | undefined;
}

function notFound(response: Response) {
  return response.status(404).json({ error: 'Document not found' });
}

function beginProcessing(db: AppDatabase, documentId: string, actor: string, requestId: string, intent?: { eventType: string; metadata?: Record<string, unknown> }) {
  const row = getDocumentRow(db, documentId);
  if (!row) throw new Error('Document not found');
  assertTransition(row.status, 'processing');
  const attempt = db.prepare('SELECT COALESCE(MAX(attempt_number), 0) + 1 AS number FROM processing_attempts WHERE document_id=?').get(documentId) as { number: number };
  const attemptId = randomUUID();
  const timestamp = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO processing_attempts
      (id,document_id,attempt_number,status,model_name,model_version,input_storage_key,requested_at,requested_by)
      VALUES (?,?,?,'queued','local-visual-model','adapter-1',?,?,?)`)
      .run(attemptId, documentId, attempt.number, row.storage_key, timestamp, actor);
    db.prepare(`UPDATE documents SET status='processing',active_attempt_id=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?`)
      .run(attemptId, timestamp, actor, documentId);
    addEvent(db, { documentId, eventType: 'processing.queued', fromStatus: row.status, toStatus: 'processing', actor, requestId, correlationId: attemptId, metadata: { attemptNumber: attempt.number } });
    if (intent) addEvent(db, { documentId, eventType: intent.eventType, fromStatus: row.status, toStatus: 'processing', actor, requestId, correlationId: attemptId, metadata: intent.metadata });
  });
  void processAttempt(db, documentId, attemptId, actor);
  return { attemptId, attemptNumber: attempt.number };
}

async function processAttempt(db: AppDatabase, documentId: string, attemptId: string, requestedBy: string) {
  const row = getDocumentRow(db, documentId);
  const attempt = db.prepare('SELECT status FROM processing_attempts WHERE id=?').get(attemptId) as { status: string } | undefined;
  if (!row || row.status !== 'processing' || row.active_attempt_id !== attemptId || !attempt || !['queued', 'running'].includes(attempt.status)) return;
  const startedAt = new Date().toISOString();
  db.prepare("UPDATE processing_attempts SET status='running',started_at=? WHERE id=?").run(startedAt, attemptId);
  addEvent(db, { documentId, eventType: 'processing.started', fromStatus: 'processing', toStatus: 'processing', actor: 'service:ocr-worker', correlationId: attemptId });
  try {
    const fields = await extractDocument(row.storage_key);
    const timestamp = new Date().toISOString();
    const latest = db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS number FROM document_revisions WHERE document_id=?').get(documentId) as { number: number };
    const revisionId = randomUUID();
    withTransaction(db, () => {
      db.prepare("UPDATE processing_attempts SET status='succeeded',output_json=?,completed_at=? WHERE id=?")
        .run(JSON.stringify({ fields }), timestamp, attemptId);
      db.prepare(`INSERT INTO document_revisions
        (id,document_id,processing_attempt_id,revision_number,fields_json,change_summary,created_at,created_by)
        VALUES (?,?,?,?,?,'Model extraction',?,'service:ocr-worker')`)
        .run(revisionId, documentId, attemptId, latest.number, JSON.stringify(fields), timestamp);
      db.prepare(`UPDATE documents SET status='draft',current_revision_id=?,updated_at=?,updated_by='service:ocr-worker',version=version+1 WHERE id=?`)
        .run(revisionId, timestamp, documentId);
      addEvent(db, { documentId, eventType: 'processing.completed', fromStatus: 'processing', toStatus: 'draft', actor: 'service:ocr-worker', correlationId: attemptId, metadata: { requestedBy, revisionNumber: latest.number } });
    });
  } catch (error) {
    const timestamp = new Date().toISOString();
    const message = error instanceof Error ? error.message : 'Unknown processing error';
    withTransaction(db, () => {
      db.prepare("UPDATE processing_attempts SET status='failed',error_code='MODEL_ERROR',error_message=?,completed_at=? WHERE id=?")
        .run(message, timestamp, attemptId);
      db.prepare("UPDATE documents SET status='not_started',updated_at=?,updated_by='service:ocr-worker',version=version+1 WHERE id=?")
        .run(timestamp, documentId);
      addEvent(db, { documentId, eventType: 'processing.failed', fromStatus: 'processing', toStatus: 'not_started', actor: 'service:ocr-worker', correlationId: attemptId, metadata: { error: message } });
    });
  }
}

export function resumePendingAttempts(db: AppDatabase) {
  const pending = db.prepare(`SELECT a.id,a.document_id,a.requested_by
    FROM processing_attempts a
    JOIN documents d ON d.active_attempt_id=a.id
    WHERE d.status='processing' AND a.status IN ('queued','running')`).all() as unknown as Array<{ id: string; document_id: string; requested_by: string }>;
  for (const attempt of pending) void processAttempt(db, attempt.document_id, attempt.id, attempt.requested_by);
  return pending.length;
}

function detailFor(db: AppDatabase, row: DocumentRow) {
  const summary = serializeDocument(db, row);
  const revision = row.current_revision_id
    ? db.prepare('SELECT revision_number,fields_json FROM document_revisions WHERE id=?').get(row.current_revision_id) as { revision_number: number; fields_json: string } | undefined
    : undefined;
  const events = db.prepare('SELECT * FROM document_events WHERE document_id=? ORDER BY created_at DESC').all(row.id) as Array<Record<string, unknown>>;
  return {
    ...summary,
    sourceUrl: row.storage_key,
    fields: revision ? JSON.parse(revision.fields_json) : [],
    revisionNumber: revision?.revision_number ?? null,
    events: events.map(event => ({
      id: event.id,
      eventType: event.event_type,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      actorType: event.actor_type,
      actorId: event.actor_id,
      actorName: event.actor_name,
      createdAt: event.created_at,
      metadata: JSON.parse(String(event.metadata_json)),
    })),
  };
}

const fieldSchema = z.object({
  id: z.string().min(1), key: z.string().min(1), label: z.string().min(1), value: z.string(),
  confidence: z.number().min(0).max(1).nullable(), origin: z.enum(['model', 'user']),
  source: z.object({ page: z.number().int().positive(), boundingBox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) }).nullable(),
});

export function createApi(db: AppDatabase) {
  const router = express.Router();

  router.get('/events', (request, response) => {
    const documentQuery = String(request.query.document || '').toLowerCase();
    const actorQuery = String(request.query.actor || '').toLowerCase();
    const eventQuery = String(request.query.event || '').toLowerCase();
    const events = db.prepare(`SELECT e.*,d.filename,d.document_type
      FROM document_events e JOIN documents d ON d.id=e.document_id
      ORDER BY e.created_at DESC LIMIT 500`).all() as Array<Record<string, unknown>>;
    response.json(events.map(event => ({
      id: event.id,
      documentId: event.document_id,
      filename: event.filename,
      documentType: event.document_type,
      eventType: event.event_type,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      actorType: event.actor_type,
      actorId: event.actor_id,
      actorName: event.actor_name,
      createdAt: event.created_at,
      metadata: JSON.parse(String(event.metadata_json)),
    })).filter(event => {
      const documentText = `${event.documentId} ${event.filename} ${event.documentType}`.toLowerCase();
      const actorText = `${event.actorType}:${event.actorId} ${event.actorName || ''}`.toLowerCase();
      return (!documentQuery || documentText.includes(documentQuery)) && (!actorQuery || actorText.includes(actorQuery)) && (!eventQuery || String(event.eventType).toLowerCase().includes(eventQuery));
    }));
  });

  router.get('/documents', (request, response) => {
    const status = request.query.status;
    const rows = (status && status !== 'all'
      ? db.prepare('SELECT * FROM documents WHERE status=? ORDER BY updated_at DESC').all(String(status))
      : db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all()) as unknown as DocumentRow[];
    response.json(rows.map(row => serializeDocument(db, row)));
  });

  router.get('/documents/:id', (request, response) => {
    const row = getDocumentRow(db, request.params.id);
    if (!row) return notFound(response);
    response.json(detailFor(db, row));
  });

  router.post('/documents/upload', upload.array('files', 50), async (request, response) => {
    const files = (request.files ?? []) as Express.Multer.File[];
    if (!files.length) return response.status(400).json({ error: 'Add at least one JPEG, PNG, WebP, or PDF file.' });
    const actor = actorFrom(request);
    const requestId = requestIdFrom(request);
    const pageCounts = await Promise.all(files.map(async file => {
      if (file.mimetype !== 'application/pdf') return 1;
      try { return (await PDFDocument.load(readFileSync(file.path))).getPageCount(); }
      catch { return 1; }
    }));
    const created = withTransaction(db, () => files.map((file, index) => {
      const id = `doc-${randomUUID()}`;
      const suffix = extname(file.originalname).toLowerCase();
      const targetName = `${id}${suffix}`;
      renameSync(file.path, resolve(uploadDir, targetName));
      const storageKey = `/uploads/${targetName}`;
      const timestamp = new Date().toISOString();
      db.prepare(`INSERT INTO documents
        (id,status,filename,storage_key,mime_type,page_count,document_type,created_at,created_by,updated_at,updated_by,version)
        VALUES (?,'not_started',?,?,?,?,?,?,?, ?,?,1)`)
        .run(id, file.originalname, storageKey, file.mimetype, pageCounts[index], 'Unclassified document', timestamp, actor, timestamp, actor);
      addEvent(db, { documentId: id, eventType: 'document.uploaded', toStatus: 'not_started', actor, requestId, metadata: { size: file.size, mimeType: file.mimetype } });
      return id;
    }));
    response.status(201).json({ documentIds: created });
  });

  router.post('/documents/:id/process', (request, response) => {
    try {
      const result = beginProcessing(db, request.params.id, actorFrom(request), requestIdFrom(request));
      response.status(202).json(result);
    } catch (error) {
      response.status(error instanceof Error && error.message === 'Document not found' ? 404 : 409).json({ error: error instanceof Error ? error.message : 'Unable to process document' });
    }
  });

  router.post('/batches/process', (request, response) => {
    const parsed = z.object({ documentIds: z.array(z.string()).min(1) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'documentIds is required' });
    const actor = actorFrom(request);
    const results = parsed.data.documentIds.map(documentId => {
      try { return { documentId, ...beginProcessing(db, documentId, actor, requestIdFrom(request)) }; }
      catch (error) { return { documentId, error: error instanceof Error ? error.message : 'Unable to process' }; }
    });
    response.status(202).json({ results });
  });

  router.patch('/documents/:id/draft', (request, response) => {
    const parsed = z.object({ expectedVersion: z.number().int(), fields: z.array(fieldSchema), changeSummary: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid draft fields', details: parsed.error.flatten() });
    const row = getDocumentRow(db, request.params.id);
    if (!row) return notFound(response);
    if (row.status !== 'draft') return response.status(409).json({ error: 'Only draft documents can be edited.' });
    if (row.version !== parsed.data.expectedVersion) return response.status(409).json({ error: 'The document changed. Refresh before saving.', currentVersion: row.version });
    const actor = actorFrom(request);
    const timestamp = new Date().toISOString();
    const revision = db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS number FROM document_revisions WHERE document_id=?').get(row.id) as { number: number };
    const revisionId = randomUUID();
    withTransaction(db, () => {
      db.prepare(`INSERT INTO document_revisions
        (id,document_id,processing_attempt_id,revision_number,fields_json,change_summary,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(revisionId, row.id, row.active_attempt_id, revision.number, JSON.stringify(parsed.data.fields), parsed.data.changeSummary ?? 'Reviewer edits', timestamp, actor);
      db.prepare('UPDATE documents SET current_revision_id=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?')
        .run(revisionId, timestamp, actor, row.id);
      addEvent(db, { documentId: row.id, eventType: 'draft.updated', fromStatus: 'draft', toStatus: 'draft', actor, requestId: requestIdFrom(request), metadata: { revisionNumber: revision.number, fieldCount: parsed.data.fields.length } });
    });
    const updated = getDocumentRow(db, row.id)!;
    response.json(detailFor(db, updated));
  });

  router.post('/documents/:id/approve', (request, response) => {
    const row = getDocumentRow(db, request.params.id);
    if (!row) return notFound(response);
    try { assertTransition(row.status, 'approved'); } catch (error) { return response.status(409).json({ error: (error as Error).message }); }
    const actor = actorFrom(request);
    const timestamp = new Date().toISOString();
    withTransaction(db, () => {
      db.prepare("UPDATE documents SET status='approved',updated_at=?,updated_by=?,version=version+1 WHERE id=?").run(timestamp, actor, row.id);
      addEvent(db, { documentId: row.id, eventType: 'document.approved', fromStatus: row.status, toStatus: 'approved', actor, requestId: requestIdFrom(request) });
    });
    response.json(detailFor(db, getDocumentRow(db, row.id)!));
  });

  router.post('/documents/:id/reject', (request, response) => {
    try {
      const row = getDocumentRow(db, request.params.id);
      if (!row) return notFound(response);
      const reason = request.body?.reason || 'Reviewer requested reprocessing';
      const eventType = row.status === 'draft' ? 'draft.rejected' : 'document.reprocess_requested';
      const result = beginProcessing(db, request.params.id, actorFrom(request), requestIdFrom(request), { eventType, metadata: { reason } });
      response.status(202).json(result);
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : 'Unable to reprocess document' });
    }
  });

  router.get('/export', (request, response) => {
    const ids = String(request.query.ids || '').split(',').filter(Boolean);
    const format = request.query.format === 'csv' ? 'csv' : 'json';
    if (!ids.length) return response.status(400).json({ error: 'Select at least one document.' });
    const docs = ids.map(id => getDocumentRow(db, id)).filter(Boolean).map(row => detailFor(db, row!));
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      response.setHeader('Content-Disposition', `attachment; filename="ocr-export-${date}.json"`);
      return response.type('application/json').send(JSON.stringify({ schemaVersion: '1.0', exportedAt: new Date().toISOString(), documents: docs }, null, 2));
    }
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const header = ['document_id','status','document_type','filename','updated_at','updated_by','revision','field_order','field_key','field_label','field_value','confidence','page','box_x','box_y','box_width','box_height'];
    const lines = [header.map(escape).join(',')];
    for (const doc of docs) (doc.fields as ExtractedField[]).forEach((field, index) => lines.push([
      doc.id, doc.status, doc.documentType, doc.filename, doc.updatedAt, doc.updatedBy, doc.revisionNumber, index,
      field.key, field.label, field.value, field.confidence, field.source?.page, field.source?.boundingBox.x,
      field.source?.boundingBox.y, field.source?.boundingBox.width, field.source?.boundingBox.height,
    ].map(escape).join(',')));
    response.setHeader('Content-Disposition', `attachment; filename="ocr-export-${date}.csv"`);
    response.type('text/csv').send(lines.join('\n'));
  });

  return router;
}
