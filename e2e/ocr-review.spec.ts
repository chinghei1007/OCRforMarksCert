import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixture = resolve(process.cwd(), 'e2e/two-page-result.pdf');
let uploadedPdfId = '';

test.beforeAll(async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([595, 842]);
  first.drawText('Two-page school result - page 1', { x: 72, y: 760, size: 20, font });
  first.drawText('Student: Jane Chan', { x: 72, y: 690, size: 14, font });
  const second = pdf.addPage([595, 842]);
  second.drawText('Two-page school result - page 2', { x: 72, y: 760, size: 20, font });
  second.drawText('Overall grade: A', { x: 72, y: 690, size: 14, font });
  await writeFile(fixture, await pdf.save());
});

test.afterAll(async () => {
  await rm(fixture, { force: true });
});

test.describe.serial('approved document views and audit repairs', () => {
  test('E01 redirects legacy document URLs to the review view', async ({ page }) => {
    await page.goto('/documents/doc-2026-00418');
    await expect(page).toHaveURL('/documents/doc-2026-00418/review');
    await expect(page.getByRole('heading', { name: 'School result' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page');
  });

  test('E02 supports reloadable review, JSON and activity document views', async ({ page }) => {
    await page.goto('/documents/doc-2026-00418/review');
    await page.getByRole('link', { name: 'JSON' }).click();
    await expect(page).toHaveURL('/documents/doc-2026-00418/json');
    await expect(page.getByRole('heading', { name: 'Document JSON' })).toBeVisible();
    await expect(page.locator('pre')).toContainText('student_name');
    await page.reload();
    await expect(page.getByRole('link', { name: 'JSON' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page).toHaveURL('/documents/doc-2026-00418/activity');
    await expect(page.getByRole('heading', { name: 'Document activity' })).toBeVisible();
    await expect(page.getByText('Document Uploaded')).toBeVisible();
  });

  test('E03 makes the sidebar Activity destination useful', async ({ page }) => {
    await page.goto('/documents');
    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page).toHaveURL('/documents/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByLabel('Filter activity by document')).toBeVisible();
    await expect(page.getByLabel('Filter activity by actor')).toBeVisible();
    await expect(page.getByLabel('Filter activity by event')).toBeVisible();
    await expect(page.locator('.global-event-row')).not.toHaveCount(0);
  });

  test('E04 uploads, processes and navigates a real two-page PDF', async ({ page, request }) => {
    await page.goto('/documents');
    await page.locator('input[type=file]').setInputFiles(fixture);
    await expect(page.getByRole('status')).toContainText('1 document uploaded');
    await page.getByLabel('Select two-page-result.pdf').check();
    await page.getByRole('button', { name: 'Process selected' }).click();
    await expect(page.getByRole('status')).toContainText('1 document queued');
    await expect(page.getByRole('row').filter({ hasText: 'two-page-result.pdf' })).toContainText('Draft', { timeout: 10_000 });
    const docs = await (await request.get('/api/documents')).json();
    uploadedPdfId = docs.find((document: { filename: string }) => document.filename === 'two-page-result.pdf').id;
    await page.getByRole('button', { name: 'Open two-page-result.pdf' }).click();
    await expect(page).toHaveURL(`/documents/${uploadedPdfId}/review`);
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(page.getByLabel('Previous page')).toBeDisabled();
    await expect(page.getByLabel('Next page')).toBeEnabled();
    await expect(page.locator('canvas.pdf-page')).toBeVisible();
    await page.getByLabel('Next page').click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByLabel('Next page')).toBeDisabled();
    await expect(page.getByLabel('Previous page')).toBeEnabled();
  });

  test('E05 retains image highlight and zoom behavior', async ({ page }) => {
    await page.goto('/documents/doc-2026-00418/review');
    await page.getByRole('textbox', { name: 'Mathematics', exact: true }).click();
    await expect(page.getByLabel('Highlighted source for Mathematics')).toBeVisible();
    await expect(page.locator('.scan-controls').getByText('82%', { exact: true })).toBeVisible();
    await page.getByLabel('Zoom in').click();
    await expect(page.locator('.scan-controls').getByText('92%', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Previous page')).toBeDisabled();
    await expect(page.getByLabel('Next page')).toBeDisabled();
  });

  test('E06 draws and persists a normalized source region for a new field', async ({ page }) => {
    await page.goto('/documents/doc-2026-00418/review');
    await page.getByRole('button', { name: 'Add missing field' }).click();
    await page.getByRole('textbox', { name: 'Label for New field' }).fill('Candidate number');
    await page.getByRole('textbox', { name: 'Candidate number', exact: true }).fill('C-2048');
    await page.getByRole('button', { name: 'Link source region' }).click();
    const source = page.locator('.document-page-wrap');
    const box = await source.boundingBox();
    if (!box) throw new Error('Source viewer has no bounding box');
    await page.mouse.move(box.x + box.width * .2, box.y + box.height * .3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .38);
    await page.mouse.up();
    await expect(page.getByText('Page 1 linked')).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status')).toContainText('Saved revision');
    await page.reload();
    await page.getByRole('textbox', { name: 'Candidate number', exact: true }).click();
    const highlight = page.getByLabel('Highlighted source for Candidate number');
    await expect(highlight).toBeVisible();
    const style = await highlight.getAttribute('style');
    expect(style).toContain('left: 20');
    expect(style).toContain('width: 35');
  });

  test('E07 records truthful events for rejection and approved reprocess', async ({ page }) => {
    await page.goto('/documents/doc-2026-00418/review');
    await page.getByRole('button', { name: 'Reject & reprocess' }).click();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByText('Draft Rejected')).toBeVisible();

    await page.goto('/documents/doc-2026-00416/review');
    await page.getByRole('button', { name: 'Reprocess' }).click();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByText('Document Reprocess Requested')).toBeVisible();
    await expect(page.getByText('Draft Rejected')).toHaveCount(0);
  });

  test('E08 exposes working document filters that can be cleared', async ({ page }) => {
    await page.goto('/documents');
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByLabel('Document type filter')).toBeVisible();
    await page.getByLabel('Document type filter').selectOption({ label: 'School transcript' });
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByText('transcript.pdf')).toBeVisible();
    await page.getByLabel('Document type filter').selectOption('all');
    await page.getByLabel('File type filter').selectOption('pdf');
    await expect(page.getByText('transcript.pdf')).toBeVisible();
    await expect(page.getByText('hong_kong_result.jpg')).toHaveCount(0);
    await page.getByLabel('File type filter').selectOption('all');
    await page.getByLabel('Updated by filter').selectOption({ label: 'service:document-importer' });
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByText('award-scan.webp')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByText('hong_kong_result.jpg')).toBeVisible();
  });

  test('E09 uses one Export menu for canonical JSON and flattened CSV', async ({ page }) => {
    await page.goto('/documents');
    await page.getByLabel('Select hong_kong_result.jpg').check();
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    const jsonPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export JSON' }).click();
    const jsonDownload = await jsonPromise;
    const jsonBody = JSON.parse(await readFile(await jsonDownload.path() as string, 'utf8'));
    expect(jsonBody.documents[0].fields[0].source.boundingBox).toBeTruthy();
    await page.getByRole('button', { name: 'Export' }).click();
    const csvPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export CSV' }).click();
    const csvBody = await readFile(await (await csvPromise).path() as string, 'utf8');
    expect(csvBody).toContain('field_order');
  });

  test('E10 contains mobile overflow inside the queue table', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/documents');
    const widths = await page.evaluate(() => ({
      rootScroll: document.documentElement.scrollWidth,
      rootClient: document.documentElement.clientWidth,
      tableScroll: document.querySelector('.table-scroll')?.scrollWidth,
      tableClient: document.querySelector('.table-scroll')?.clientWidth,
    }));
    expect(widths.rootScroll).toBe(widths.rootClient);
    expect(widths.tableScroll).toBeGreaterThan(widths.tableClient ?? 0);
  });
});
