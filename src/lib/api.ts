import type { DocumentDetail, DocumentEvent, DocumentListItem, ExtractedField } from '../types';

const actorHeaders = { 'x-actor-id': 'user:demo.reviewer' };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...actorHeaders, ...(options?.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || 'Request failed');
  }
  return response.json();
}

export const api = {
  list: (status = 'all') => request<DocumentListItem[]>(`/api/documents?status=${status}`),
  get: (id: string) => request<DocumentDetail>(`/api/documents/${id}`),
  events: () => request<DocumentEvent[]>('/api/events'),
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    return request<{ documentIds: string[] }>('/api/documents/upload', { method: 'POST', body: form });
  },
  processBatch: (documentIds: string[]) => request('/api/batches/process', { method: 'POST', body: JSON.stringify({ documentIds }) }),
  saveDraft: (id: string, expectedVersion: number, fields: ExtractedField[]) => request<DocumentDetail>(`/api/documents/${id}/draft`, { method: 'PATCH', body: JSON.stringify({ expectedVersion, fields }) }),
  approve: (id: string) => request<DocumentDetail>(`/api/documents/${id}/approve`, { method: 'POST', body: '{}' }),
  reject: (id: string) => request(`/api/documents/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'Reviewer requested reprocessing' }) }),
};
