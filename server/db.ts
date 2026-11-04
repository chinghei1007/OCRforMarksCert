import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DocumentStatus } from './state-machine';
import type { ExtractedField } from '../src/types';

const defaultPath = resolve(process.cwd(), 'data/ocr-review.db');

export type AppDatabase = DatabaseSync;

function now() {
  return new Date().toISOString();
}

export function createDatabase(path = defaultPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db: AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('not_started','processing','draft','approved')),
      filename TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 1,
      document_type TEXT NOT NULL DEFAULT 'Unknown document',
      current_revision_id TEXT,
      active_attempt_id TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_documents_status_updated ON documents(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS processing_attempts (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
      model_name TEXT,
      model_version TEXT,
      input_storage_key TEXT NOT NULL,
      output_json TEXT,
      error_code TEXT,
      error_message TEXT,
      requested_at TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(document_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS document_revisions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      processing_attempt_id TEXT REFERENCES processing_attempts(id),
      revision_number INTEGER NOT NULL,
      fields_json TEXT NOT NULL,
      change_summary TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(document_id, revision_number)
    );

    CREATE TABLE IF NOT EXISTS document_events (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT,
      request_id TEXT,
      correlation_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_document_events_history ON document_events(document_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS outbox_events (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT
    );
  `);
}

export function withTransaction<T>(db: AppDatabase, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function addEvent(db: AppDatabase, input: {
  documentId: string;
  eventType: string;
  fromStatus?: DocumentStatus | null;
  toStatus?: DocumentStatus | null;
  actor: string;
  actorName?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [actorType, ...idParts] = input.actor.split(':');
  const actorId = idParts.join(':') || input.actor;
  const createdAt = now();
  const eventId = randomUUID();
  const metadata = input.metadata ?? {};
  db.prepare(`INSERT INTO document_events
    (id, document_id, event_type, from_status, to_status, actor_type, actor_id, actor_name, request_id, correlation_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(eventId, input.documentId, input.eventType, input.fromStatus ?? null, input.toStatus ?? null,
      actorType, actorId, input.actorName ?? null, input.requestId ?? null, input.correlationId ?? null,
      JSON.stringify(metadata), createdAt);
  db.prepare(`INSERT INTO outbox_events (id, topic, aggregate_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), `documents.${input.eventType}`, input.documentId,
      JSON.stringify({ eventId, ...input, createdAt }), createdAt);
}

const demoFields: ExtractedField[] = [
  { id: 'fld-student-name', key: 'student_name', label: 'Student name', value: 'Jane Chan', confidence: .96, origin: 'model', source: { page: 1, boundingBox: { x: .21, y: .245, width: .59, height: .055 } } },
  { id: 'fld-school', key: 'school', label: 'School', value: 'Harbour Secondary School', confidence: .98, origin: 'model', source: { page: 1, boundingBox: { x: .18, y: .085, width: .64, height: .05 } } },
  { id: 'fld-year', key: 'academic_year', label: 'Academic year', value: '2025–2026', confidence: .91, origin: 'model', source: { page: 1, boundingBox: { x: .22, y: .315, width: .35, height: .04 } } },
  { id: 'fld-english', key: 'english_language', label: 'English Language', value: 'B+', confidence: .92, origin: 'model', source: { page: 1, boundingBox: { x: .63, y: .475, width: .16, height: .04 } } },
  { id: 'fld-maths', key: 'mathematics', label: 'Mathematics', value: 'A', confidence: .94, origin: 'model', source: { page: 1, boundingBox: { x: .63, y: .535, width: .16, height: .04 } } },
  { id: 'fld-physics', key: 'physics', label: 'Physics', value: 'A−', confidence: .88, origin: 'model', source: { page: 1, boundingBox: { x: .63, y: .595, width: .16, height: .04 } } },
  { id: 'fld-overall', key: 'overall_grade', label: 'Overall grade', value: 'A−', confidence: .67, origin: 'model', source: { page: 1, boundingBox: { x: .63, y: .655, width: .16, height: .04 } } },
];

export function seedDatabase(db: AppDatabase) {
  const count = Number((db.prepare('SELECT COUNT(*) AS count FROM documents').get() as { count: number }).count);
  if (count) return;
  const documents = [
    ['doc-2026-00418', 'draft', 'hong_kong_result.jpg', '/demo-document.svg', 'image/jpeg', 'School result', 'service:ocr-worker'],
    ['doc-2026-00417', 'processing', 'certificate-amy.png', '/demo-certificate.svg', 'image/png', 'Competition certificate', 'user:alex.chan'],
    ['doc-2026-00416', 'approved', 'transcript.pdf', '/demo-transcript.pdf', 'application/pdf', 'School transcript', 'user:may.wong'],
    ['doc-2026-00415', 'not_started', 'award-scan.webp', '/demo-certificate.svg', 'image/webp', 'Competition certificate', 'service:document-importer'],
  ] as const;
  withTransaction(db, () => {
    for (const [id, status, filename, storageKey, mimeType, documentType, actor] of documents) {
      const timestamp = new Date(Date.now() - documents.findIndex(row => row[0] === id) * 12 * 60_000).toISOString();
      db.prepare(`INSERT INTO documents
        (id,status,filename,storage_key,mime_type,page_count,document_type,created_at,created_by,updated_at,updated_by,version)
        VALUES (?,?,?,?,?,1,?,?,?,?,?,1)`)
        .run(id, status, filename, storageKey, mimeType, documentType, timestamp, actor, timestamp, actor);
      addEvent(db, { documentId: id, eventType: 'document.uploaded', toStatus: 'not_started', actor });
      if (status !== 'not_started') {
        const attemptId = randomUUID();
        const attemptStatus = status === 'processing' ? 'running' : 'succeeded';
        db.prepare(`INSERT INTO processing_attempts
          (id,document_id,attempt_number,status,model_name,model_version,input_storage_key,requested_at,requested_by,started_at,completed_at)
          VALUES (?,?,1,?,'local-visual-model','demo-1',?,?,?,?,?)`)
          .run(attemptId, id, attemptStatus, storageKey, timestamp, actor, timestamp, attemptStatus === 'succeeded' ? timestamp : null);
        db.prepare('UPDATE documents SET active_attempt_id=? WHERE id=?').run(attemptId, id);
        if (status !== 'processing') {
          const revisionId = randomUUID();
          db.prepare(`INSERT INTO document_revisions
            (id,document_id,processing_attempt_id,revision_number,fields_json,change_summary,created_at,created_by)
            VALUES (?,?,?,1,?,'Initial model extraction',?,?)`)
            .run(revisionId, id, attemptId, JSON.stringify(demoFields), timestamp, 'service:ocr-worker');
          db.prepare('UPDATE documents SET current_revision_id=? WHERE id=?').run(revisionId, id);
        }
      }
    }
  });
}

export { demoFields };
