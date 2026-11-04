import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExtractedField } from '../types';

GlobalWorkerOptions.workerSrc = workerUrl;

type Point = { x: number; y: number };

export function SourceViewer({ sourceUrl, mimeType, filename, pageCount, active, zoom, setZoom, drawing, onRegion }: {
  sourceUrl: string; mimeType: string; filename: string; pageCount: number; active: ExtractedField | null;
  zoom: number; setZoom: (value: number) => void; drawing: boolean;
  onRegion: (source: NonNullable<ExtractedField['source']>) => void;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfPages, setPdfPages] = useState(pageCount);
  const [start, setStart] = useState<Point | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const isPdf = mimeType === 'application/pdf';
  const totalPages = isPdf ? pdfPages : 1;

  useEffect(() => {
    setPageNumber(1);
    setPdfPages(pageCount);
  }, [sourceUrl, pageCount]);

  useEffect(() => {
    if (!isPdf || !canvasRef.current) return;
    let cancelled = false;
    const task = getDocument({ url: sourceUrl });
    void task.promise.then(async pdf => {
      if (cancelled) return;
      setPdfPages(pdf.numPages);
      const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.45 });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask.current?.cancel();
      const current = page.render({ canvas, canvasContext: context, viewport });
      renderTask.current = current;
      await current.promise.catch(error => { if (error?.name !== 'RenderingCancelledException') throw error; });
    }).catch(() => undefined);
    return () => { cancelled = true; renderTask.current?.cancel(); void task.destroy(); };
  }, [isPdf, sourceUrl, pageNumber]);

  const pointFor = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event); setStart(point); setDraft({ ...point, width: 0, height: 0 });
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing || !start) return;
    const point = pointFor(event);
    setDraft({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
  };
  const pointerUp = () => {
    if (drawing && draft && draft.width > .01 && draft.height > .01) onRegion({ page: pageNumber, boundingBox: draft });
    setStart(null); setDraft(null);
  };
  const box = (active?.source?.page === pageNumber ? active.source.boundingBox : null) ?? draft;

  return <section className="scan-panel">
    <div className="scan-tools"><span>Page {pageNumber} of {totalPages}</span><div className="scan-controls">
      <button className="icon-btn" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => setPageNumber(value => Math.max(1, value - 1))}><ChevronLeft size={15} /></button>
      <button className="icon-btn" aria-label="Zoom out" onClick={() => setZoom(Math.max(45, zoom - 10))}><ZoomOut size={15} /></button><span>{zoom}%</span>
      <button className="icon-btn" aria-label="Zoom in" onClick={() => setZoom(Math.min(130, zoom + 10))}><ZoomIn size={15} /></button>
      <button className="icon-btn" aria-label="Next page" disabled={pageNumber >= totalPages} onClick={() => setPageNumber(value => Math.min(totalPages, value + 1))}><ChevronRight size={15} /></button>
    </div></div>
    <div className="scan-stage">
      <div className={`document-page-wrap ${drawing ? 'drawing-region' : ''}`} style={{ width: `${zoom}%` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
        {isPdf ? <canvas ref={canvasRef} className="pdf-page" aria-label={`Page ${pageNumber} of ${filename}`} /> : <img className="document-image" src={sourceUrl} alt={`Original scan of ${filename}`} />}
        {box && <div className={`source-highlight ${draft ? 'source-draft' : ''}`} aria-label={active ? `Highlighted source for ${active.label}` : undefined} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}>{active && !draft && <span>{active.label}</span>}</div>}
      </div>
    </div>
  </section>;
}
