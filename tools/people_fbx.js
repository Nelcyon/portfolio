// Drives tools/people_fbx.html in headless Chromium and saves each character it builds.
// Usage: node tools/people_fbx.js <page url> <out dir>   (needs the playwright package)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('error:', e.message));
  await page.goto(process.argv[2]);
  await page.waitForFunction(() => window.done, null, { timeout: 300000 });
  const out = await page.evaluate(() => window.out);
  fs.mkdirSync(process.argv[3], { recursive: true });
  for (const [name, b64] of Object.entries(out)) fs.writeFileSync(`${process.argv[3]}/${name}.glb`, Buffer.from(b64, 'base64'));
  console.log(Object.keys(out).join(' '));
  await browser.close();
})();
