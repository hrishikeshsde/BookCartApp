// Page check for BookCart: opens every kind of page in Chrome and fails on a failed request, a console error, a
// Content-Security-Policy violation or a missing font. The policy is report-only until Security:EnforceCsp is true, so
// nothing is blocked today: the violations are reported through the browser's securitypolicyviolation event, which is
// what this script listens to. If it is clean, switching the policy to enforcing will not break the site.
//
// Usage: cd scripts/smoke && npm install && WEB=http://localhost:8080 node pages.js
//   WEB          the site to check (the Docker deployment by default; for development: https://localhost:53424)
//   CHROME_PATH  the Chrome to drive (a default for Windows is built in)
// The site needs at least one book (run smoke.js first, or add one as the admin), for the details page.
// The 401 answers that signed-out visitors get on pages that need a login (/wishlist, /checkout) are expected.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const puppeteer = require('puppeteer-core');
const WEB = process.env.WEB || 'http://localhost:8080';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const books = await (await fetch(WEB + '/api/book')).json();
  if (!books.length) throw new Error('The site has no books: the details page cannot be checked. Add one first.');
  const pages = ['/', '/login', '/register', '/wishlist', '/shopping-cart', '/checkout', `/books/details/${books[0].bookId}`, '/search?item=a', '/nope-not-a-page'];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, acceptInsecureCerts: true, args: ['--no-sandbox'] });
  let problems = 0;
  for (const path of pages) {
    const page = await browser.newPage();
    const bad = [], failed = [], errors = [];
    let docHeaders = {};
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI} (${e.disposition})`));
    });
    page.on('response', (r) => {
      if (r.request().resourceType() === 'document' && r.url() === WEB + path) docHeaders = r.headers();
      if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(WEB, '')}`);
    });
    page.on('requestfailed', (r) => failed.push(r.url().replace(WEB, '') + ' ' + (r.failure()?.errorText || '')));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 140)));
    await page.goto(WEB + path, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));
    const info = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
      return { csp: window.__csp, fonts: [...new Set(loaded)], h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).join(' | '), url: location.pathname + location.search };
    });
    const expected401 = /^401 (POST \/api\/login|GET \/api\/(wishlist|order))/;
    const unexpectedBad = bad.filter((s) => !expected401.test(s));
    const unexpectedErrors = errors.filter((e) => !/status of 401/.test(e));
    const missingFonts = ['Roboto', 'Material Icons'].filter((f) => !info.fonts.includes(f));
    const flag = unexpectedBad.length + failed.length + unexpectedErrors.length + info.csp.length + missingFonts.length;
    problems += flag;
    console.log(`${flag ? 'FAIL' : 'ok  '} ${path.padEnd(22)} -> ${info.url.padEnd(20)} h1="${info.h1}"  fonts: ${info.fonts.join(', ') || 'none'}`);
    if (unexpectedBad.length) console.log('       bad responses:', unexpectedBad.join('; '));
    if (failed.length) console.log('       failed requests:', failed.join('; '));
    if (unexpectedErrors.length) console.log('       console errors:', unexpectedErrors.join('; '));
    if (info.csp.length) console.log('       CSP violations:', info.csp.join('; '));
    if (missingFonts.length) console.log('       fonts not loaded:', missingFonts.join(', '));
    if (path === '/') console.log('       document CSP header:', (docHeaders['content-security-policy-report-only'] || docHeaders['content-security-policy'] || 'MISSING').slice(0, 70) + '...');
    await page.close();
  }
  await browser.close();
  console.log(problems ? `\n${problems} problem(s)` : '\nno failed request, no console error, no CSP violation, fonts loaded');
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
