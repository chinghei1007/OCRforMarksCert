import type { DocumentStatus } from '../server/state-machine';

export type BoundingBox = { x: number; y: number; width: number; height: number };

export type ExtractedField = {
  id: string;
  key: string;
  label: string;
  value: string;
  confidence: number | null;
  source: { page: number; boundingBox: BoundingBox } | null;
  origin: 'model' | 'user';
};

export type DocumentListItem = {
  id: string;
  filename: string;
  mimeType: string;
  pageCount: number;
  status: DocumentStatus;
  documentType: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  selected?: boolean;
  attemptNumber: number | null;
  attemptStatus: string | null;
};

export type DocumentDetail = DocumentListItem & {
  sourceUrl: string;
  fields: ExtractedField[];
  revisionNumber: number | null;
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: DocumentStatus | null;
    toStatus: DocumentStatus | null;
    actorType: string;
    actorId: string;
    actorName: string | null;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
};

export type DocumentEvent = DocumentDetail['events'][number] & {
  documentId: string;
  filename: string;
  documentType: string;
};
