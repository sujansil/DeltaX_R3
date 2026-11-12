// Local Chromium rehearsal; always starts R3 with an isolated temporary database.
const assert = require('node:assert/strict');
const {mkdtempSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = mkdtempSync(path.join(tmpdir(), 'deltax-r3-math-'));
const python = process.env.R3_CHECK_PYTHON || path.join(root, '.venv/bin/python');
const env = {...process.env, R3_DATA_DIR: path.join(artifacts, 'data'), R3_SECURE_COOKIES: '0'};
const seeded = spawnSync(python, ['-c', `
import app
with app.transaction() as db:
    db.execute('INSERT INTO admin VALUES(?,?)', ('math-check', app.hash_password('local-math-check-123')))
`], {cwd: root, env, encoding: 'utf8'});
assert.equal(seeded.status, 0, seeded.stderr);
const server = spawn(python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '0'], {cwd: root, env});
let browser;
const inline = String.raw`\(x^2 + y^2 = r^2\)`;
const display = String.raw`\[\frac{80\sqrt{3}}{57}\]`;
const math = `${inline} and ${display}`;
const body = `## Plain heading\n\nPlain text & <img src=x onerror=alert(1)> **bold text**.\n\nInline ${inline}. Display ${display}\n\nDollar $x^2 + y^2 = r^2$ and $$\\frac{80\\sqrt{3}}{57}$$\n\n- List ${inline}\n\n:: ${display}\n\nMultiline:\n\\[\n\\frac{80\\sqrt{3}}{57}\n\\]\n\nUnicode x² + y² = r². Cost \\$5 and \\$10.\n\nTrust ${String.raw`\(\href{https://example.com}{blocked}\)`}\n\nMalformed ${String.raw`\(\badcommand{\)`}`;

(async () => {
  const baseURL = await new Promise((resolve, reject) => {
    let log = '';
    const timeout = setTimeout(() => reject(Error(log || 'Server startup timed out')), 15000);
    server.stderr.on('data', chunk => {
      log += chunk;
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    server.on('error', reject);
    server.on('exit', code => { clearTimeout(timeout); reject(Error(`Server exited ${code}: ${log}`)); });
  });
  browser = await chromium.launch({headless: true});
  const admin = await browser.newPage({baseURL});
  const audience = await browser.newPage({baseURL}); // Separate, anonymous browser context.
  const errors = [], external = [], failed = [];
  admin.setDefaultTimeout(15000);
  audience.setDefaultTimeout(15000);
  for (const page of [admin, audience]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!req.url().startsWith(baseURL)) external.push(req.url()); });
    page.on('response', res => { if (res.status() >= 400 && !res.url().endsWith('/api/admin/session')) failed.push(`${res.status()} ${res.url()}`); });
    await page.route('**/*', route => route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
  }
  await audience.goto('/');
  assert.match(await audience.locator('body').innerText(), /Everything will be revealed soon/);
  assert.deepEqual(await (await audience.request.get('/api/public')).json(), {masked: true});
  await admin.goto('/admin');
  await admin.locator('#username').fill('math-check');
  await admin.locator('#password').fill('local-math-check-123');
  await admin.locator('#loginForm button[type=submit]').click();
  await admin.locator('#adminApp').waitFor({state: 'visible'});
  const api = admin.context().request;
  const csrf = (await (await api.get('/api/admin/session')).json()).csrf;
  async function write(url, data, method = 'post') {
    const response = await api[method](url, {data, headers: {'X-CSRF-Token': csrf}});
    assert.ok(response.ok(), `${url}: ${await response.text()}`);
  }
  async function rendered(page, selector, count) {
    await page.waitForFunction(({selector, count}) => document.querySelectorAll(`${selector} .katex`).length >= count, {selector, count});
    const result = await page.locator(selector).evaluate(el => ({
      inline: [...el.querySelectorAll('.katex')].filter(k => !k.closest('.katex-display')).length,
      display: el.querySelectorAll('.katex-display').length,
      annotations: [...el.querySelectorAll('annotation')].map(a => a.textContent),
    }));
    assert.ok(result.inline > 0 && result.display > 0, JSON.stringify(result));
    assert.ok(result.annotations.includes('x^2 + y^2 = r^2'));
    assert.ok(result.annotations.includes(String.raw`\frac{80\sqrt{3}}{57}`));
  }
  for (const track of ['A', 'B']) {
    await write(`/api/admin/questions/${track}`, {title: `Helios ${track} ${inline}`, subtitle: math, blurb: math, content: body}, 'put');
  }
  await write('/api/admin/shared', {shared: `## Shared conditions\n\n${math}`}, 'put');
  await write('/api/admin/visibility', {revealed: true});
  // The sealed landing page detects reveal and reloads itself.
  await audience.locator('[data-open="A"]').waitFor();
  for (const track of ['A', 'B']) {
    await rendered(audience, `.track-card:nth-child(${track === 'A' ? 1 : 2})`, 5);
    await audience.locator(`[data-open="${track}"]`).click();
    await rendered(audience, '#dialogBody', 8);
    await rendered(audience, '#dialogShared', 2);
    assert.match(await audience.locator('#dialogBody').innerText(), /Plain text & <img src=x onerror=alert\(1\)> bold text/);
    assert.equal(await audience.locator('#dialogBody img, #dialogBody a').count(), 0);
    assert.equal(await audience.locator('#dialogBody strong').innerText(), 'bold text');
    assert.match(await audience.locator('#dialogBody').innerText(), /Cost \\\$5 and \\\$10/);
    if (track === 'A') {
      await write('/api/admin/questions/A', {title: `Helios A ${inline}`, subtitle: math, blurb: math, content: `Updated while open.\n\n${body}`}, 'put');
      await audience.waitForFunction(() => document.querySelector('#dialogBody').textContent.includes('Updated while open.'));
      await rendered(audience, '#dialogBody', 8);
    }
    await audience.locator('#closeDialog').click();
  }
  await audience.locator('#sharedBtn').click();
  await rendered(audience, '#dialogBody', 2);
  await audience.locator('#closeDialog').click();
  await audience.screenshot({path: path.join(artifacts, 'preview.png'), fullPage: true});
  console.log('PASS: preview cards, both dialogs, open-dialog updates and shared conditions.');

  // Exercise the real admin form submission and its formatting preview.
  await admin.locator('[data-section="questions"]').click();
  await admin.locator('#qContent').fill(body);
  await admin.locator('#previewQuestionBtn').click();
  await rendered(admin, '#previewBody', 8);
  await admin.locator('#closePreview').click();
  const saved = admin.waitForResponse(res => res.url().endsWith('/api/admin/questions/A') && res.request().method() === 'PUT');
  await admin.locator('#questionForm button[type=submit]').click();
  assert.ok((await saved).ok());

  for (const track of ['A', 'B']) {
    await write('/api/admin/select', {track});
    await rendered(audience, '.selected-text', 8);
    await rendered(audience, '.selected-head-main', 3);
    await audience.locator('#sharedToggle').click();
    await rendered(audience, '#sharedBody', 2);
    assert.match(await audience.locator('.selected-aside').innerText(), /Submit work in the supplied answer booklet/);
    await write(`/api/admin/questions/${track}`, {title: `Helios ${track} ${inline}`, subtitle: math, blurb: math, content: `Selected update ${track}\n\n${body}`}, 'put');
    await audience.waitForFunction(track => document.querySelector('.selected-text')?.textContent.includes(`Selected update ${track}`), track);
    await rendered(audience, '.selected-text', 8);
    await write('/api/admin/timer', {action: 'start', duration_minutes: 2});
    await audience.waitForFunction(() => document.querySelector('#publicPhaseLabel')?.textContent.includes('LIVE'));
    const before = await audience.locator('#publicClock').innerText();
    await audience.waitForFunction(before => document.querySelector('#publicClock').textContent !== before, before);
    await rendered(audience, '.selected-text', 8);
    await write('/api/admin/timer', {action: 'pause'});
    await audience.waitForFunction(() => document.querySelector('#publicPhaseLabel')?.textContent.includes('PAUSED'));
    await write('/api/admin/shared', {shared: `Updated shared ${track}\n\n${math}`}, 'put');
    await audience.waitForFunction(track => document.querySelector('#sharedBody')?.textContent.includes(`Updated shared ${track}`), track);
    await rendered(audience, '#sharedBody', 2);
    await write('/api/admin/timer', {action: 'resume'});
    await audience.waitForFunction(() => document.querySelector('#publicPhaseLabel')?.textContent.includes('LIVE'));
    await audience.reload();
    await rendered(audience, '.selected-text', 8);
    await write('/api/admin/timer', {action: 'finish'});
    await audience.waitForFunction(() => document.querySelector('#publicPhaseLabel')?.textContent.includes('ENDED'));
    await rendered(audience, '.selected-text', 8);
    await audience.screenshot({path: path.join(artifacts, `selected-${track}.png`), fullPage: true});
    console.log(`PASS: selected track ${track}, polling, reload and timer lifecycle.`);
    await write('/api/admin/timer', {action: 'reset_round'});
    await audience.locator('[data-open="A"]').waitFor();
  }

  // Uploaded images remain downloadable and decodable with the gate open.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC', 'base64');
  const uploaded = await api.post('/api/admin/resources/upload?title=Image%20check&visible=true', {headers: {'X-CSRF-Token': csrf}, multipart: {file: {name: 'check.png', mimeType: 'image/png', buffer: png}}});
  assert.ok(uploaded.ok());
  await audience.locator('#resourcesTab').click();
  await audience.locator('.public-resource').waitFor();
  const imageURL = await audience.locator('.public-resource').getAttribute('href');
  const image = await audience.request.get(imageURL);
  assert.ok(image.ok());
  assert.deepEqual(await image.body(), png);
  assert.equal(await audience.evaluate(async url => {
    const response = await fetch(url);
    const image = await createImageBitmap(await response.blob());
    return image.width;
  }, imageURL), 1);
  await audience.locator('#challengeTab').click();
  assert.equal(await audience.locator('.math-diagram[role=img]').count(), 2);
  await audience.setViewportSize({width: 390, height: 844});
  await audience.locator('[data-open="A"]').click();
  await rendered(audience, '#dialogBody', 8);
  await audience.screenshot({path: path.join(artifacts, 'mobile-dialog.png'), fullPage: true});
  await write('/api/admin/visibility', {revealed: false});
  await audience.waitForFunction(() => document.body.textContent.includes('Everything will be revealed soon'));
  assert.equal(await audience.locator('.katex').count(), 0);
  assert.equal((await audience.request.get(imageURL)).status(), 401);
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  assert.deepEqual(external, [], 'Unexpected external requests');
  assert.deepEqual(failed, [], 'Failed page assets or API requests');
  console.log(`PASS: all four delimiters; both briefs, shared conditions, cards, selected tracks, live updates, admin preview/save, timer lifecycle, text, diagrams, image download/decode, mobile and seal. No external requests or JS errors.\nScreenshots and isolated test data: ${artifacts}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill('SIGTERM');
});
