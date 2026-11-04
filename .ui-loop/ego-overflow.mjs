const task = await taskSpace(7);
const page = task.page("p1");
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await page.goto("http://127.0.0.1:4173/documents");
await page.waitForSelector("text=Document operations", { state: "visible" });
const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
  .map(el => {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: el.className?.toString().slice(0, 80),
      text: el.textContent?.trim().slice(0, 50),
      left: rect.left,
      right: rect.right,
      width: rect.width,
      scroll: el.scrollWidth,
      client: el.clientWidth,
      overflow: getComputedStyle(el).overflowX,
    };
  })
  .filter(item => item.right > innerWidth + 1 || item.width > innerWidth + 1)
  .sort((a, b) => b.right - a.right)
  .slice(0, 20));
console.log(overflow);
await page.cdp("Emulation.clearDeviceMetricsOverride");
