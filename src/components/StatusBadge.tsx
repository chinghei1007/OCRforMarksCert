import type { DocumentStatus } from '../../server/state-machine';

const labels: Record<DocumentStatus, string> = {
  not_started: 'Not started', processing: 'Processing', draft: 'Draft', approved: 'Approved',
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
