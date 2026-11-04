import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { api } from '../lib/api';
import type { DocumentEvent } from '../types';

function eventName(value: string) {
  return value.split(/[._]/).map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

export function ActivityPage() {
  const [events, setEvents] = useState<DocumentEvent[]>([]);
  const [documentFilter, setDocumentFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { api.events().then(setEvents).catch(error => setMessage((error as Error).message)); }, []);
  const filtered = useMemo(() => events.filter(event => {
    const documentText = `${event.documentId} ${event.filename} ${event.documentType}`.toLowerCase();
    const actorText = `${event.actorType}:${event.actorId} ${event.actorName ?? ''}`.toLowerCase();
    return documentText.includes(documentFilter.toLowerCase()) && actorText.includes(actorFilter.toLowerCase()) && event.eventType.toLowerCase().includes(eventFilter.toLowerCase());
  }), [events, documentFilter, actorFilter, eventFilter]);

  return <AppShell>
    <div className="page-heading"><div><p className="eyebrow">System history</p><h1>Activity</h1><p className="subcopy">Trace document events, service authors, and reviewer actions.</p></div></div>
    <section className="activity-page-panel">
      <div className="activity-filters">
        <label>Document<input aria-label="Filter activity by document" value={documentFilter} onChange={event => setDocumentFilter(event.target.value)} placeholder="ID, filename or type" /></label>
        <label>Actor<input aria-label="Filter activity by actor" value={actorFilter} onChange={event => setActorFilter(event.target.value)} placeholder="user or service" /></label>
        <label>Event<input aria-label="Filter activity by event" value={eventFilter} onChange={event => setEventFilter(event.target.value)} placeholder="approved, processing…" /></label>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      <div className="global-event-list">{filtered.map(event => <div className="global-event-row" key={event.id}>
        <div><Link to={`/documents/${event.documentId}/activity`}>{event.documentType}</Link><span>{event.filename} · {event.documentId}</span></div>
        <strong>{eventName(event.eventType)}</strong>
        <code>{event.actorType}:{event.actorId}</code>
        <time>{new Intl.DateTimeFormat('en-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</time>
      </div>)}</div>
      {!filtered.length && <div className="empty-table">No events match these filters.</div>}
    </section>
  </AppShell>;
}
