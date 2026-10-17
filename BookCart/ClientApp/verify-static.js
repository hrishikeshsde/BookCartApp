// Checks a built site folder the way a browser would see it: every file the HTML and the CSS refer to exists where they
// say it does, and no page carries an inline script or an event-handler attribute (the Content-Security-Policy would
// block them). Usage: node verify-static.js [folder]   (default: dist/browser; also works on a publish folder's wwwroot)
// It exists because a publish step once flattened dist/ into wwwroot, which answered every font with a 404 while the
// dev server and the unit tests were happy.
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || path.join(__dirname, "dist", "browser"));
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error(`verify-static: no index.html in ${root}`);
  process.exit(2);
}

const problems = [];
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(root);

const isExternalOrInline = (ref) => /^(data:|https?:|\/\/|#|mailto:)/i.test(ref);
const exists = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

for (const file of files.filter((f) => f.endsWith(".css"))) {
  const css = fs.readFileSync(file, "utf8");
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const ref = match[2];
    if (isExternalOrInline(ref)) continue;
    const target = path.resolve(path.dirname(file), ref.split(/[?#]/)[0]);
    if (!exists(target)) problems.push(`${path.relative(root, file)}: url(${ref}) does not exist`);
  }
}

for (const file of files.filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(file, "utf8");
  const where = path.relative(root, file);
  for (const match of html.matchAll(/<(?:script|link|img|source)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)) {
    const ref = match[1];
    if (isExternalOrInline(ref)) continue;
    // <base href="/"> makes every reference relative to the site root
    const target = path.join(root, ref.split(/[?#]/)[0].replace(/^\//, ""));
    if (!exists(target)) problems.push(`${where}: ${ref} does not exist`);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const hasSrc = /\bsrc=/.test(match[1]);
    const isData = /type="(application\/json|application\/ld\+json)"/.test(match[1]);
    if (!hasSrc && !isData && match[2].trim()) problems.push(`${where}: an inline <script> (blocked by script-src 'self')`);
  }
  for (const match of html.matchAll(/<[a-z][^>]*\s(on[a-z]+)=/gi)) {
    problems.push(`${where}: an inline ${match[1]}= handler (blocked by script-src 'self')`);
  }
}

if (problems.length) {
  console.error(`verify-static: ${problems.length} problem(s) in ${root}`);
  for (const p of [...new Set(problems)]) console.error("  " + p);
  process.exit(1);
}
console.log(`verify-static: ${files.length} files in ${root}, every reference resolves, no inline script or handler`);
