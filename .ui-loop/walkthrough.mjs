import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error('Set BASE_URL before replay.');
const output = resolve(process.env.OUTPUT_DIR ?? 'walkthrough-screenshots');
await mkdir(output, { recursive: true });

const source = `
const task = await taskSpace(25);
const page = task.page("p1");
await page.goto(${JSON.stringify(new URL('/documents', baseUrl).href)});
await page.screenshot({ path: ${JSON.stringify(`${output}/2-1-queue.png`)} });
await page.click("loc=role:tab[name='Draft']", { label: "filter draft documents" });
await page.click("text=School result", { label: "open draft document" });
await page.waitForSelector("loc=css:input[aria-label='Student name']", { state: "visible" });
await page.click("loc=css:input[aria-label='Student name']", { label: "focus student field" });
await page.waitForSelector("loc=css:[aria-label='Highlighted source for Student name']", { state: "visible" });
await page.screenshot({ path: ${JSON.stringify(`${output}/3-1-field-focus.png`)} });
await page.click("text=Add missing field", { label: "add missing field" });
await page.fill("loc=css:input[aria-label='Label for New field']", "Candidate number");
await page.fill("loc=css:input[aria-label='Candidate number']", "C-4096");
await page.click("loc=css:button[aria-label='Move Candidate number up']", { label: "reorder candidate field" });
await page.click("text=Save draft", { label: "save draft revision" });
await page.waitForSelector("text=Draft Updated", { state: "visible" });
await page.waitForSelector("text=user:demo.reviewer", { state: "visible" });
await page.screenshot({ path: ${JSON.stringify(`${output}/4-1-actor-history.png`)} });
console.log({ taskSpaceId: task.spaceId, completed: true, output: ${JSON.stringify(output)} });
`;

await new Promise((done, reject) => {
  const child = spawn('ego-browser', ['nodejs', '-e', source], { stdio: 'inherit' });
  child.once('error', error => reject(new Error(`Start ego-browser: ${error.message}`)));
  child.once('exit', code => code === 0 ? done() : reject(new Error(`Replay failed: ego-browser exit ${code}`)));
});
