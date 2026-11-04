import { spawn } from 'node:child_process';

const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error('Set BASE_URL before replay.');
const source = `
const task = await taskSpace("OCR marks certificate verification replay");
const page = task.page("p1");
await page.goto(${JSON.stringify(new URL('/documents', baseUrl).href)});
await page.waitForSelector("loc=role:heading[name='Documents']", { state: "visible" });
await page.click("text=Filters", { label: "open queue filters" });
await page.selectOption("loc=css:select[aria-label='File type filter']", "pdf");
await page.click("text=Clear filters", { label: "clear queue filters" });
await page.goto(${JSON.stringify(new URL('/documents/doc-2026-00418/review', baseUrl).href)});
await page.waitForSelector("text=Extracted fields", { state: "visible" });
await page.click("loc=css:input[aria-label='Mathematics']", { label: "inspect source highlight" });
await page.click("loc=css:button[aria-label='Zoom in']", { label: "zoom source preview" });
await page.goto(${JSON.stringify(new URL('/documents/doc-2026-00418/json', baseUrl).href)});
await page.waitForSelector("text='Document JSON'", { state: "visible" });
await page.goto(${JSON.stringify(new URL('/documents/doc-2026-00418/activity', baseUrl).href)});
await page.waitForSelector("text='Document activity'", { state: "visible" });
await page.goto(${JSON.stringify(new URL('/documents/activity', baseUrl).href)});
await page.waitForSelector("loc=css:input[aria-label='Filter activity by event']", { state: "visible" });
console.log({ taskSpaceId: task.spaceId, completed: true });
await task.finish({ keep: [] });
`;

await new Promise((resolve, reject) => {
  const child = spawn('ego-browser', ['nodejs', '-e', source], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`ego-browser exited ${code}`)));
});
