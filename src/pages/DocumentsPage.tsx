import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Download, Filter, RefreshCw, Search, Upload } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import type { DocumentListItem } from '../types';
import type { DocumentStatus } from '../../server/state-machine';

const tabs: Array<{ value: 'all' | DocumentStatus; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'not_started', label: 'Not started' },
  { value: 'processing', label: 'Processing' }, { value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' },
];

function shortId(id: string) {
  return id.startsWith('doc-2026') ? id.toUpperCase() : id.slice(0, 17).toUpperCase();
}

export function DocumentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') || 'all') as 'all' | DocumentStatus;
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [documentType, setDocumentType] = useState('all');
  const [fileType, setFileType] = useState('all');
  const [updatedBy, setUpdatedBy] = useState('all');
  const [showExport, setShowExport] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try { setDocuments(await api.list(status)); }
    catch (error) { setMessage((error as Error).message); }
  };

  useEffect(() => { void load(); const timer = window.setInterval(load, 2500); return () => window.clearInterval(timer); }, [status]);

  const filtered = useMemo(() => documents.filter(document => {
    const value = `${document.id} ${document.filename} ${document.documentType}`.toLowerCase();
    const fileGroup = document.mimeType === 'application/pdf' ? 'pdf' : 'image';
    return value.includes(query.toLowerCase()) && (documentType === 'all' || document.documentType === documentType) && (fileType === 'all' || fileGroup === fileType) && (updatedBy === 'all' || document.updatedBy === updatedBy);
  }), [documents, query, documentType, fileType, updatedBy]);
  const documentTypes = useMemo(() => [...new Set(documents.map(document => document.documentType))].sort(), [documents]);
  const updaters = useMemo(() => [...new Set(documents.map(document => document.updatedBy))].sort(), [documents]);

  const toggleAll = () => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(document => document.id)));
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const processSelected = async () => {
    const ids = [...selected].filter(id => documents.find(document => document.id === id)?.status !== 'processing');
    if (!ids.length) return setMessage('Select at least one document that is not already processing.');
    setBusy(true); setMessage('');
    try { await api.processBatch(ids); setSelected(new Set()); await load(); setMessage(`${ids.length} document${ids.length === 1 ? '' : 's'} queued.`); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setMessage('');
    try { const result = await api.upload(files); await load(); setMessage(`${result.documentIds.length} document${result.documentIds.length === 1 ? '' : 's'} uploaded.`); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); if (uploadRef.current) uploadRef.current.value = ''; }
  };

  const exportSelection = (format: 'json' | 'csv') => {
    const ids = [...selected];
    if (!ids.length) return setMessage('Select one or more documents to export.');
    window.location.href = `/api/export?ids=${encodeURIComponent(ids.join(','))}&format=${format}`;
  };

  const formatDate = (value: string) => new Intl.DateTimeFormat('en-HK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

  return <AppShell>
    <div className="page-heading">
      <div><p className="eyebrow">Document operations</p><h1>Documents</h1><p className="subcopy">Upload scans, control the processing queue, and review extracted data.</p></div>
      <div className="button-row">
        <div className="export-menu-wrap"><button className="btn btn-neutral" disabled={!selected.size} aria-expanded={showExport} onClick={() => setShowExport(value => !value)}><Download size={15} />Export</button>{showExport && <div className="export-menu" role="menu"><button role="menuitem" onClick={() => { setShowExport(false); exportSelection('json'); }}>Export JSON</button><button role="menuitem" onClick={() => { setShowExport(false); exportSelection('csv'); }}>Export CSV</button></div>}</div>
        <input ref={uploadRef} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => void uploadFiles([...event.target.files || []])} />
        <button className="btn btn-primary" onClick={() => uploadRef.current?.click()} disabled={busy}><Upload size={15} />Upload documents</button>
      </div>
    </div>

    <div className="metric-row">
      <div className="metric"><span>Waiting for approval</span><strong>{documents.filter(document => document.status === 'draft').length}</strong></div>
      <div className="metric"><span>Processing now</span><strong>{documents.filter(document => document.status === 'processing').length}</strong></div>
      <div className="metric"><span>Selected</span><strong>{selected.size}</strong></div>
    </div>

    <div className="tab-row" role="tablist">
      {tabs.map(tab => <button key={tab.value} role="tab" aria-selected={status === tab.value} className={`tab ${status === tab.value ? 'tab-active' : ''}`} onClick={() => setParams(tab.value === 'all' ? {} : { status: tab.value })}>{tab.label}</button>)}
    </div>

    <section className="table-panel">
      <div className="table-tools">
        <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search document ID, type or filename" /></label>
        <div className="button-row"><button className="btn btn-neutral" aria-expanded={showFilters} onClick={() => setShowFilters(value => !value)}><Filter size={15} />Filters</button><button className="btn btn-soft-blue" disabled={!selected.size || busy} onClick={() => void processSelected()}><RefreshCw size={15} />{busy ? 'Working…' : 'Process selected'}</button></div>
      </div>
      {showFilters && <div className="filter-panel"><label>Document type<select aria-label="Document type filter" value={documentType} onChange={event => setDocumentType(event.target.value)}><option value="all">All document types</option>{documentTypes.map(type => <option key={type}>{type}</option>)}</select></label><label>File type<select aria-label="File type filter" value={fileType} onChange={event => setFileType(event.target.value)}><option value="all">All file types</option><option value="image">Images</option><option value="pdf">PDF</option></select></label><label>Updated by<select aria-label="Updated by filter" value={updatedBy} onChange={event => setUpdatedBy(event.target.value)}><option value="all">All updaters</option>{updaters.map(actor => <option key={actor}>{actor}</option>)}</select></label><button className="btn btn-neutral" onClick={() => { setDocumentType('all'); setFileType('all'); setUpdatedBy('all'); setQuery(''); }}>Clear filters</button></div>}
      {message && <div className="notice" role="status">{message}</div>}
      <div className="table-scroll">
        <table className="document-table">
          <thead><tr><th><input aria-label="Select all visible documents" type="checkbox" checked={Boolean(filtered.length) && selected.size === filtered.length} onChange={toggleAll} /></th><th>Document</th><th>Status</th><th>Updated</th><th>Updated by</th><th>Attempt</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{filtered.map(document => <tr key={document.id} className={selected.has(document.id) ? 'row-selected' : ''}>
            <td><input aria-label={`Select ${document.filename}`} type="checkbox" checked={selected.has(document.id)} onChange={() => toggle(document.id)} /></td>
            <td><button className="document-link" onClick={() => navigate(`/documents/${document.id}/review`)}><strong>{document.documentType}</strong><span>{shortId(document.id)} · {document.filename}</span></button></td>
            <td><StatusBadge status={document.status} /></td><td>{formatDate(document.updatedAt)}</td><td><span className="actor-id">{document.updatedBy}</span></td>
            <td>{document.attemptNumber ? `#${document.attemptNumber} ${document.attemptStatus}` : '—'}</td><td><button aria-label={`Open ${document.filename}`} className="icon-btn" onClick={() => navigate(`/documents/${document.id}/review`)}><ChevronRight size={16} /></button></td>
          </tr>)}</tbody>
        </table>
        {!filtered.length && <div className="empty-table">No documents match this view.</div>}
      </div>
      <footer className="table-footer"><span>{filtered.length} document{filtered.length === 1 ? '' : 's'}</span><span>JPEG, PNG, WebP and PDF · 25 MB per file · 50 files per batch</span></footer>
    </section>
  </AppShell>;
}
