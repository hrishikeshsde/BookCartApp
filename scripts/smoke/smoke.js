// Browser smoke test for BookCart (see docs/FRONTEND_CHANGES.md). Needs: the backend on https://localhost:7073 running
// against the LocalDB database BookDB_Dev (it promotes the smoke admin there with sqlcmd), the Angular dev server on
// https://localhost:53424 (override with WEB=...), and Chrome (override with CHROME_PATH=...).
// Usage: cd scripts/smoke && npm install && node smoke.js [--expect-f1]
//   --expect-f1  treat the "known issue" checks as required (after the F1 security phase they must pass)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const API = 'https://localhost:7073';
const WEB = process.env.WEB || 'https://localhost:53424';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXPECT_F1 = process.argv.includes('--expect-f1');
const ADMIN = { username: 'smokeadmin', password: 'SmokeAdmin1' };
const USER = { username: 'smoke' + Date.now().toString(36).slice(-7), password: 'SmokeUser1x' };

const results = [];
let firstTitle = '';
const consoleErrors = new Set();
const badResponses = [];
const externalRequests = new Set();

async function step(name, fn, { known = false } = {}) {
  try {
    await fn();
    results.push({ name, ok: true, known });
    console.log('PASS  ' + name);
  } catch (e) {
    results.push({ name, ok: false, known, error: e.message.split('\n')[0] });
    console.log((known && !EXPECT_F1 ? 'KNOWN ' : 'FAIL  ') + name + '  -> ' + e.message.split('\n')[0]);
  }
}

// ---- API seeding -------------------------------------------------------------------------------------------------
async function api(path, init = {}) {
  const r = await fetch(API + path, init);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
const json = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

async function seed() {
  const reg = await api('/api/user', json({ firstName: 'Smoke', lastName: 'Admin', username: ADMIN.username, password: ADMIN.password, confirmPassword: ADMIN.password, gender: 'Male' }));
  if (![200, 409].includes(reg.status)) throw new Error('register admin: ' + reg.status);
  execSync(`sqlcmd -S "(localdb)\\MSSQLLocalDB" -d BookDB_Dev -E -C -Q "UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '${ADMIN.username}'"`, { stdio: 'ignore' });
  const login = await api('/api/login', json(ADMIN));
  if (login.status !== 200) throw new Error('login admin: ' + login.status + ' ' + JSON.stringify(login.body));
  const token = login.body.token;
  const books = (await api('/api/book')).body;
  const have = books.filter((b) => b.title.startsWith('Smoke Book')).length;
  const cats = (await api('/api/book/GetCategoriesList')).body;
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8])], { type: 'image/png' });
  for (let i = have + 1; i <= 3; i++) {
    const f = new FormData();
    f.append('title', 'Smoke Book ' + i); f.append('author', 'Smoke Author'); f.append('category', cats[0].categoryName);
    f.append('price', String(i * 100)); f.append('file', png, 'c.png');
    const r = await api('/api/book', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: f });
    if (r.status !== 201) throw new Error('create book: ' + r.status + ' ' + JSON.stringify(r.body));
  }
}

// ---- browser helpers ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickText(page, selector, text) {
  const ok = await page.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(t));
    if (!el) return false; el.click(); return true;
  }, selector, text);
  if (!ok) throw new Error(`no ${selector} containing "${text}"`);
}
const waitFn = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 15000 }, ...args);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
async function badges(page) {
  return page.evaluate(() => [...document.querySelectorAll('.mat-badge-content')].map((e) => e.textContent.trim()));
}
async function logoutIfNeeded(page) {
  const has = await page.evaluate(() => !!localStorage.getItem('authToken'));
  if (!has) return;
  await clickText(page, 'mat-toolbar button', 'account_circle');
  await page.waitForSelector('button[mat-menu-item]');
  await clickText(page, 'button[mat-menu-item]', 'Logout');
  await waitFn(page, () => location.pathname === '/login');
}
async function uiLogin(page, u) {
  await page.goto(WEB + '/login', { waitUntil: 'networkidle2' });
  await page.type('input[formcontrolname="username"]', u.username);
  await page.type('input[formcontrolname="password"]', u.password);
  await clickText(page, 'form button', 'Login');
  await waitFn(page, () => !!localStorage.getItem('authToken'));
}

(async () => {
  console.log(`Smoke run (${EXPECT_F1 ? 'F1 expected' : 'baseline'}), user ${USER.username}`);
  await seed();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, acceptInsecureCerts: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.add(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.add('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url().replace(WEB, '').replace(API, '')}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(WEB) && !u.startsWith(API) && !u.startsWith('data:') && !u.startsWith('blob:')) externalRequests.add(u.slice(0, 90)); });

  await step('home lists the seeded books', async () => {
    await page.goto(WEB, { waitUntil: 'networkidle2' });
    await page.waitForSelector('app-book-card');
    if ((await count(page, 'app-book-card')) < 3) throw new Error('fewer than 3 cards');
  });
  await step('Material Icons and Roboto are self-hosted and loaded', async () => {
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
    if (!fonts.includes('Material Icons')) throw new Error('Material Icons not loaded: ' + fonts.join(','));
    if (!fonts.includes('Roboto')) throw new Error('Roboto not loaded: ' + fonts.join(','));
  });
  await step('guest adds a book to the cart (badge 1)', async () => {
    firstTitle = await page.$eval('app-book-card .title a', (e) => e.textContent.trim());
    await page.click('app-addtocart button');
    await waitFn(page, () => [...document.querySelectorAll('.mat-badge-content')].some((e) => e.textContent.trim() === '1'));
  });
  await step('search narrows the list to one book', async () => {
    await page.click('input.searchbox');
    await page.type('input.searchbox', 'Smoke Book 2');
    await page.keyboard.press('Enter');
    await waitFn(page, () => location.pathname === '/search');
    await waitFn(page, () => document.querySelectorAll('app-book-card').length === 1);
  });
  await step('book details page opens from a card', async () => {
    await page.click('app-book-card .title a');
    await waitFn(page, () => location.pathname.startsWith('/books/details/'));
    await waitFn(page, () => document.body.innerText.includes('Smoke Book 2'));
  });
  await step('details: opening the address directly shows the book and the books similar to it', async () => {
    const url = page.url();
    await page.goto(url, { waitUntil: 'networkidle2' });
    await waitFn(page, () => document.body.innerText.includes('Smoke Book 2'));
    await waitFn(page, () => document.querySelectorAll('app-similarbooks app-book-card').length >= 1);
  });
  await step('register: a taken username is flagged by the async check', async () => {
    await page.goto(WEB + '/register', { waitUntil: 'networkidle2' });
    await page.type('input[formcontrolname="userName"]', ADMIN.username);
    await page.keyboard.press('Tab');   // the message only shows once the field is touched
    await waitFn(page, () => document.body.innerText.includes('User Name is not available'));
  });
  await step('register a new user through the form', async () => {
    await page.goto(WEB + '/register', { waitUntil: 'networkidle2' });
    await page.type('input[formcontrolname="firstName"]', 'Smoke');
    await page.type('input[formcontrolname="lastName"]', 'User');
    await page.type('input[formcontrolname="userName"]', USER.username);
    await waitFn(page, () => { const i = document.querySelector('input[formcontrolname="userName"]'); return i.classList.contains('ng-valid') && !i.classList.contains('ng-pending'); });
    await page.type('input[formcontrolname="password"]', USER.password);
    await page.type('input[formcontrolname="confirmPassword"]', USER.password);
    await clickText(page, 'mat-radio-button label', 'Male');
    await clickText(page, 'form button', 'Register');
    await waitFn(page, () => location.pathname === '/login');
  });
  await step('login keeps the guest cart (merged, badge still 1)', async () => {
    await page.type('input[formcontrolname="username"]', USER.username);
    await page.type('input[formcontrolname="password"]', USER.password);
    await clickText(page, 'form button', 'Login');
    await waitFn(page, () => !!localStorage.getItem('authToken'));
    await waitFn(page, () => [...document.querySelectorAll('.mat-badge-content')].some((e) => e.textContent.trim() === '1'));
  });
  await step('shopping cart page shows the item', async () => {
    await page.goto(WEB + '/shopping-cart', { waitUntil: 'networkidle2' });
    await waitFn(page, (t) => document.querySelectorAll('li.item-row').length >= 1 && document.body.innerText.includes(t), firstTitle);
  });
  await step('checkout places an order and My Orders lists it', async () => {
    await page.goto(WEB + '/checkout', { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[formcontrolname="name"]');
    await page.type('input[formcontrolname="name"]', 'Smoke User');
    await page.type('input[formcontrolname="addressLine1"]', '1 Test Street');
    await page.type('input[formcontrolname="addressLine2"]', 'Test Area');
    await page.type('input[formcontrolname="pincode"]', '560001');
    await page.type('input[formcontrolname="state"]', 'Karnataka');
    await clickText(page, 'form button', 'Place Order');
    await waitFn(page, () => location.pathname === '/myorders');
    await waitFn(page, () => document.querySelectorAll('table tbody tr').length >= 1);
  });
  await step('My Orders: a row opens to show its books, and closes again', async () => {
    await page.goto(WEB + '/myorders', { waitUntil: 'networkidle2' });
    await page.waitForSelector('tr.example-element-row');
    const open = () => page.waitForFunction(() => { const d = document.querySelector('.example-element-detail-inner'); return d.getBoundingClientRect().height > 20 && getComputedStyle(d).visibility === 'visible'; }, { timeout: 15000 });
    const shut = () => page.waitForFunction(() => { const d = document.querySelector('.example-element-detail-inner'); return d.getBoundingClientRect().height < 2 && getComputedStyle(d).visibility === 'hidden'; }, { timeout: 15000 });
    await shut();                                   // closed to begin with
    await page.click('tr.example-element-row');
    await open();
    await page.click('tr.example-element-row');
    await shut();
  });
  await step('wishlist: add from the home page and see it on /wishlist', async () => {
    await page.goto(WEB, { waitUntil: 'networkidle2' });
    await page.waitForSelector('app-addtowishlist .favourite-unselected');
    await page.click('app-addtowishlist .favourite-unselected');
    await waitFn(page, () => document.querySelectorAll('app-addtowishlist .favourite-selected').length === 1);
    await page.goto(WEB + '/wishlist', { waitUntil: 'networkidle2' });
    await waitFn(page, (t) => document.body.innerText.includes(t) && !document.body.innerText.includes('Your wishlist is empty'), firstTitle);
  });
  await step('a signed-in non-admin on /admin/books is sent home', async () => {
    await page.goto(WEB + '/admin/books', { waitUntil: 'networkidle2' });
    await waitFn(page, () => location.pathname === '/');
  });
  await step('logout clears the token and returns to login', async () => {
    await page.goto(WEB, { waitUntil: 'networkidle2' });
    await logoutIfNeeded(page);
    const t = await page.evaluate(() => localStorage.getItem('authToken'));
    if (t) throw new Error('token still stored');
  });
  await step('a visitor who is not signed in is sent from /admin/books to login, with returnUrl', async () => {
    await page.goto(WEB + '/admin/books', { waitUntil: 'networkidle2' });
    await waitFn(page, () => location.pathname === '/login' && location.search.includes('returnUrl=%2Fadmin%2Fbooks'));
  }, { known: true });
  await step('a wrong password shows the message and keeps the visitor on /login', async () => {
    await page.goto(WEB + '/login', { waitUntil: 'networkidle2' });
    await page.type('input[formcontrolname="username"]', ADMIN.username);
    await page.type('input[formcontrolname="password"]', 'WrongPass1');
    await clickText(page, 'form button', 'Login');
    await waitFn(page, () => document.body.innerText.includes('Username or Password is incorrect'));
    if (await page.evaluate(() => !!localStorage.getItem('authToken'))) throw new Error('a token was stored');
  });
  await step('login goes back to the page the visitor was headed for', async () => {
    await page.goto(WEB + '/wishlist', { waitUntil: 'networkidle2' });
    await waitFn(page, () => location.pathname === '/login' && location.search.includes('returnUrl=%2Fwishlist'));
    await page.type('input[formcontrolname="username"]', USER.username);
    await page.type('input[formcontrolname="password"]', USER.password);
    await clickText(page, 'form button', 'Login');
    await waitFn(page, () => location.pathname === '/wishlist');
    await logoutIfNeeded(page);
  });
  await step('a returnUrl that points off-site is ignored after login', async () => {
    await page.goto(WEB + '/login?returnUrl=//evil.com', { waitUntil: 'networkidle2' });
    await page.type('input[formcontrolname="username"]', USER.username);
    await page.type('input[formcontrolname="password"]', USER.password);
    await clickText(page, 'form button', 'Login');
    await waitFn(page, () => !!localStorage.getItem('authToken') && location.pathname === '/');
    if (!(await page.evaluate(() => location.origin)).startsWith('https://localhost')) throw new Error('left the app');
  }, { known: true });
  await step('token removed behind the app: the next call goes to login without a page reload', async () => {
    await page.evaluate(() => { window.__marker = 'same-document'; localStorage.removeItem('authToken'); });
    await clickText(page, 'mat-toolbar a', 'favorite');
    await waitFn(page, () => location.pathname === '/login' && location.search.includes('returnUrl=%2Fwishlist'));
    if ((await page.evaluate(() => window.__marker)) !== 'same-document') throw new Error('the page was reloaded');
  }, { known: true });
  await step('an expired token counts as logged out', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const expired = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: '1', name: 'x', exp: 1 })}.sig`;
    await page.evaluate((t) => localStorage.setItem('authToken', t), expired);
    await page.goto(WEB + '/wishlist', { waitUntil: 'networkidle2' });
    await waitFn(page, () => location.pathname === '/login' && location.search.includes('returnUrl=%2Fwishlist'));
    if (await page.evaluate(() => !!localStorage.getItem('authToken'))) throw new Error('the expired token is still stored');
  }, { known: true });
  await step('admin: login and the manage-books table lists books', async () => {
    await uiLogin(page, ADMIN);
    await page.goto(WEB + '/admin/books', { waitUntil: 'networkidle2' });
    await waitFn(page, () => location.pathname === '/admin/books' && document.querySelectorAll('table tbody tr').length >= 3);
  });
  await step('admin: hard refresh on /admin/books stays on the page', async () => {
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);
    const p = await page.evaluate(() => location.pathname);
    if (p !== '/admin/books') throw new Error('redirected to ' + p);
  }, { known: true });
  await step('admin: edit opens the book form with the title filled in', async () => {
    await page.goto(WEB + '/admin/books', { waitUntil: 'networkidle2' });
    await page.waitForSelector('table tbody tr button');
    await page.click('table tbody tr button');
    await waitFn(page, () => location.pathname.startsWith('/admin/books/') && document.querySelector('input[formcontrolname="title"]')?.value.length > 0);
  });

  await step('admin: the edit page opened by its address (a refresh) shows the book, not a blank Add form', async () => {
    const url = page.url();
    if (!new URL(url).pathname.match(/^\/admin\/books\/[0-9]+$/)) throw new Error('not on an edit page: ' + url);
    await page.goto(url, { waitUntil: 'networkidle2' });
    await waitFn(page, () => document.querySelector('input[formcontrolname="title"]')?.value.length > 0);
    if (!(await page.evaluate(() => document.body.innerText.includes('Edit')))) throw new Error('the page says Add, not Edit');
  });
  await browser.close();

  const failed = results.filter((r) => !r.ok && (!r.known || EXPECT_F1));
  const known = results.filter((r) => !r.ok && r.known && !EXPECT_F1);
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed.length} failed, ${known.length} known issues`);
  console.log('console errors:', consoleErrors.size ? [...consoleErrors].join('\n  ') : 'none');
  const uniq = [...new Set(badResponses)];
  console.log('responses >= 400:', uniq.length ? '\n  ' + uniq.join('\n  ') : 'none');
  console.log('external requests:', externalRequests.size ? '\n  ' + [...externalRequests].join('\n  ') : 'none');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('smoke crashed:', e); process.exit(2); });
