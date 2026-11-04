import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, GripVertical, Link2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { SourceViewer } from '../components/SourceViewer';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import type { DocumentDetail, ExtractedField } from '../types';

function EventName({ value }: { value: string }) {
  return <>{value.split(/[._]/).map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ')}</>;
}

export function ReviewPage() {
  const { id = '', view = 'review' } = useParams();
  const navigate = useNavigate();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(82);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await api.get(id);
      setDocument(result); setFields(result.fields);
      setActiveId(current => current && result.fields.some(field => field.id === current) ? current : result.fields[0]?.id || null);
    } catch (error) { setMessage((error as Error).message); }
  };
  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    if (document?.status !== 'processing') return;
    const timer = window.setInterval(load, 500); return () => window.clearInterval(timer);
  }, [document?.status, id]);

  const active = useMemo(() => fields.find(field => field.id === activeId) ?? null, [fields, activeId]);
  const changed = document ? JSON.stringify(fields) !== JSON.stringify(document.fields) : false;
  const attentionCount = fields.filter(field => field.confidence !== null && field.confidence < .8).length;
  const updateField = (fieldId: string, patch: Partial<ExtractedField>) => setFields(current => current.map(field => field.id === fieldId ? { ...field, ...patch } : field));
  const moveField = (fieldId: string, direction: -1 | 1) => setFields(current => {
    const index = current.findIndex(field => field.id === fieldId); const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
  });
  const dropOn = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return setDraggedId(null);
    setFields(current => { const next = [...current]; const from = next.findIndex(field => field.id === draggedId); const to = next.findIndex(field => field.id === targetId); const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); setDraggedId(null);
  };
  const addField = () => {
    const field: ExtractedField = { id: crypto.randomUUID(), key: `custom_field_${fields.length + 1}`, label: 'New field', value: '', confidence: null, origin: 'user', source: null };
    setFields(current => [...current, field]); setActiveId(field.id); setDrawing(false);
  };
  const save = async () => {
    if (!document) return; setBusy(true); setMessage('');
    try { const updated = await api.saveDraft(document.id, document.version, fields); setDocument(updated); setFields(updated.fields); setMessage(`Saved revision ${updated.revisionNumber}.`); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  const approve = async () => {
    if (!document) return; setBusy(true);
    try { let current = document; if (changed) current = await api.saveDraft(document.id, document.version, fields); const updated = await api.approve(current.id); setDocument(updated); setFields(updated.fields); setMessage('Document approved.'); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!document) return; setBusy(true);
    try { await api.reject(document.id); setMessage('Reprocessing started.'); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  if (!['review', 'json', 'activity'].includes(view)) return <Navigate to={`/documents/${id}/review`} replace />;
  if (!document) return <div className="loading-page">{message || 'Loading document…'}</div>;

  const header = <>
    <header className="review-topbar">
      <div className="review-title"><button className="icon-btn" aria-label="Back to documents" onClick={() => navigate('/documents')}><ArrowLeft size={17} /></button><div><span className="review-kicker">Documents / {document.id.toUpperCase()} / {view}</span><div className="title-line"><h1>{document.documentType}</h1><StatusBadge status={document.status} /></div></div></div>
      <div className="button-row">
        {document.status === 'draft' && <><button className="btn btn-danger" onClick={() => void reject()} disabled={busy}><RotateCcw size={15} />Reject &amp; reprocess</button><button className="btn btn-neutral" onClick={() => void save()} disabled={!changed || busy}><Save size={15} />Save draft</button><button className="btn btn-primary" onClick={() => void approve()} disabled={busy}><Check size={15} />Approve</button></>}
        {document.status === 'approved' && <button className="btn btn-soft-blue" onClick={() => void reject()} disabled={busy}><RotateCcw size={15} />Reprocess</button>}
      </div>
    </header>
    <nav className="document-view-nav" aria-label="Document views"><NavLink to={`/documents/${id}/review`}>Review</NavLink><NavLink to={`/documents/${id}/json`}>JSON</NavLink><NavLink to={`/documents/${id}/activity`}>Activity</NavLink></nav>
    {message && <div className="review-notice" role="status">{message}</div>}
  </>;

  if (view === 'json') return <div className="review-page">{header}<main className="document-view-page"><p className="eyebrow">Canonical export order</p><h2>Document JSON</h2><p className="subcopy">Field array order matches the review order and is preserved in exports.</p><pre className="json-preview document-json">{JSON.stringify({ id: document.id, status: document.status, documentType: document.documentType, revisionNumber: document.revisionNumber, fields }, null, 2)}</pre></main></div>;
  if (view === 'activity') return <div className="review-page">{header}<main className="document-view-page"><p className="eyebrow">Audit trail</p><h2>Document activity</h2><div className="activity-panel activity-full"><div className="activity-heading"><h3>All events</h3><span>{document.events.length} events</span></div>{document.events.map(event => <div className="activity-row" key={event.id}><span className="event-dot" /><div><strong><EventName value={event.eventType} /></strong><span>{new Intl.DateTimeFormat('en-HK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(event.createdAt))}</span></div><code>{event.actorType}:{event.actorId}</code></div>)}</div></main></div>;

  return <div className="review-page">{header}<div className="review-grid">
    <SourceViewer sourceUrl={document.sourceUrl} mimeType={document.mimeType} filename={document.filename} pageCount={document.pageCount} active={active} zoom={zoom} setZoom={setZoom} drawing={drawing} onRegion={source => { if (active) updateField(active.id, { source }); setDrawing(false); }} />
    <section className="field-panel">
      <div className="field-heading"><div><p className="eyebrow">Revision {document.revisionNumber ?? '—'} · Attempt #{document.attemptNumber ?? '—'}</p><h2>Extracted fields</h2><p className="subcopy">Select a field to locate it in the scan, or draw a missing source region.</p></div>{document.status === 'draft' && active && <button className={`btn ${drawing ? 'btn-soft-blue' : 'btn-neutral'}`} onClick={() => setDrawing(value => !value)}><Link2 size={15} />{drawing ? 'Draw on source' : 'Link source region'}</button>}</div>
      {active?.source && <div className="linked-region">Page {active.source.page} linked</div>}
      {document.status === 'processing' && <div className="processing-banner"><span className="spinner" />The local model is processing this document. This view will update automatically.</div>}
      {attentionCount > 0 && <div className="attention-banner"><span>{attentionCount} field{attentionCount === 1 ? '' : 's'} need attention</span><strong>Confidence below 80%</strong></div>}
      <div className="field-list">{fields.map((field, index) => <div key={field.id} draggable onDragStart={() => setDraggedId(field.id)} onDragOver={event => event.preventDefault()} onDrop={() => dropOn(field.id)} onClick={() => { setActiveId(field.id); setDrawing(false); }} className={`field-card ${field.id === activeId ? 'field-active' : ''}`}>
        <div className="drag-handle" title="Drag to reorder"><GripVertical size={16} /></div>
        <div className="field-inputs"><input aria-label={`Label for ${field.label}`} className="field-label-input" value={field.label} onChange={event => updateField(field.id, { label: event.target.value, key: event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_') })} /><input aria-label={field.label} className="field-value-input" value={field.value} onChange={event => updateField(field.id, { value: event.target.value })} /></div>
        <div className={`confidence ${field.confidence !== null && field.confidence < .8 ? 'confidence-low' : ''}`}>{field.confidence === null ? 'Added' : `${Math.round(field.confidence * 100)}%`}</div>
        <div className="field-actions"><button className="mini-btn" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={event => { event.stopPropagation(); moveField(field.id, -1); }}><ArrowUp size={13} /></button><button className="mini-btn" aria-label={`Move ${field.label} down`} disabled={index === fields.length - 1} onClick={event => { event.stopPropagation(); moveField(field.id, 1); }}><ArrowDown size={13} /></button><button className="mini-btn mini-danger" aria-label={`Delete ${field.label}`} onClick={event => { event.stopPropagation(); setFields(current => current.filter(item => item.id !== field.id)); }}><Trash2 size={13} /></button></div>
      </div>)}</div>
      {document.status === 'draft' && <button className="add-field" onClick={addField}><Plus size={15} />Add missing field</button>}
    </section>
  </div></div>;
}
