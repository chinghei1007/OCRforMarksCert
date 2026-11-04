import express from 'express';
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createDatabase, seedDatabase } from './db';
import { createApi, resumePendingAttempts } from './api';

const app = express();
const port = Number(process.env.PORT || 4173);
const demoPdfPath = resolve(process.cwd(), 'public/demo-transcript.pdf');
if (!existsSync(demoPdfPath)) {
  const demoPdf = await PDFDocument.create();
  const font = await demoPdf.embedFont(StandardFonts.Helvetica);
  const page = demoPdf.addPage([595, 842]);
  page.drawText('School transcript', { x: 72, y: 760, size: 22, font });
  page.drawText('Student: Jane Chan', { x: 72, y: 700, size: 14, font });
  page.drawText('Academic year: 2025-2026', { x: 72, y: 670, size: 14, font });
  writeFileSync(demoPdfPath, await demoPdf.save());
}
const db = createDatabase(process.env.DB_PATH);
seedDatabase(db);
resumePendingAttempts(db);

app.use(express.json({ limit: '4mb' }));
app.use('/uploads', express.static(resolve(process.cwd(), 'uploads')));
app.use('/api', createApi(db));

if (process.env.NODE_ENV === 'production') {
  const dist = resolve(process.cwd(), 'dist');
  app.use(express.static(dist));
  app.get('*path', (_request, response) => response.sendFile(resolve(dist, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = app.listen(port, () => {
  console.log(`OCR Review running at http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => server.close(() => db.close()));
process.on('SIGINT', () => server.close(() => db.close()));

if (!existsSync(resolve(process.cwd(), 'uploads'))) {
  console.warn('Upload directory was not created.');
}
