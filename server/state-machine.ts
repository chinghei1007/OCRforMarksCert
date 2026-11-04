export const documentStatuses = ['not_started', 'processing', 'draft', 'approved'] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

const transitions: Record<DocumentStatus, DocumentStatus[]> = {
  not_started: ['processing'],
  processing: ['draft', 'not_started'],
  draft: ['processing', 'approved'],
  approved: ['processing'],
};

export function canTransition(from: DocumentStatus, to: DocumentStatus) {
  return transitions[from].includes(to);
}

export function assertTransition(from: DocumentStatus, to: DocumentStatus) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid document transition: ${from} → ${to}`);
  }
}
