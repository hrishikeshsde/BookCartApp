# Frontend Changes (F0 onward)

What was changed in `BookCart/ClientApp`, phase by phase, how it was checked, and what is still open. Plan: [FRONTEND_IMPLEMENTATION_PLAN.md](FRONTEND_IMPLEMENTATION_PLAN.md). The backend equivalent is [BACKEND_CHANGES.md](BACKEND_CHANGES.md).

All phases are done on one branch (`modernize/f1-security`, created by the repo owner) instead of one branch per phase as the plan says. Nothing is committed by the tooling.

| Phase | Theme | State |
|---|---|---|
| Step 0 | Baseline | Done |
| F0 | Hygiene and quick fixes | Done |
| F1 | Security | Done (HttpOnly cookie transport is open, see the end) |
| F2 | Test infrastructure | Done (not yet run on GitHub CI) |
| F3 | Upgrade to Angular 22 (and Vitest) | Done |
| F4 to F7 | Signals, SignalStore, styling, SSR | Not started |

## Step 0: baseline

Angular 20.1, TypeScript 5.8, NgRx 19, rxjs 7.5, Node 24.21, npm 11. `npm ci` works (`ClientApp/.npmrc` carries `legacy-peer-deps`, see the backend notes) and `npm run build` passed before any change:

| | Raw | Transfer |
|---|---|---|
| Initial total | 1.08 MB | 239.71 kB |
| `main` | 220 kB | |
| Largest chunk | 397 kB | |
| Warning | initial bundle over the 1 MB budget by 81 kB | |

36 generated "should create" specs exist and the test runner cannot start (F2). No browser run had ever been done against the final API: the smoke test below is the first.

The plan's `git stash` / `git checkout -b` were not used (the branch exists; the stash holds only old backend edits, see [BACKEND_PENDING_ITEMS.md](BACKEND_PENDING_ITEMS.md)).

## F0: hygiene and quick fixes

**Dependencies.** Removed `ts-node`, `@types/jasminewd2`, `jasmine-spec-reporter`, `karma-coverage-istanbul-reporter` (and its line in `karma.conf.js`). `rxjs` to `~7.8.2`, `@types/node` to `^24`. `run-script-os` stays (the plan says it is low value to change).

**Bug fixes**
- Wishlist button opened a new store subscription on every input change; it now has one for the component's life (`addtowishlist`).
- `User.lastName` was typed `number`.
- Username availability check: the doubled debounce is one `timer(500)` inside a cancellable async validator, the name is URL-encoded, a failed lookup (for example the rate limit) no longer blocks the form.
- Price filter pushed a string into a number subject; the event is typed and converted.
- Home page dispatched an action inside `map()`; it now follows the query string in the constructor.
- Book add/update/delete no longer refetch the whole list (the reducer already applies the change).
- Unused imports removed (`http2` in the auth effects, `act`, and others); `@for` loops track by id instead of object identity (removes the dev-mode NG0956 warning).
- Found by the browser test, present in the original code: **pressing Enter in the search box did nothing in Chrome.** Chrome fires a `search` event on Enter and the template's handler navigated straight back to `/`. The handler now only cancels when the box is empty.
- Already fixed by the backend work, so nothing to do: the `//` in book URLs, the null user in the checkout effect.

**`main.ts`.** Removed `importProvidersFrom(BrowserModule)`, `enableProdMode()` and the unused `PreloadingStrategy` import; one `provideStore(...)`. `src/environments/` and the `fileReplacements` entry are gone (they only fed `enableProdMode`; the plan has this in F3.3).

**Fonts and icons.** `index.html` no longer loads anything from Google or a CDN. Roboto 300/400/500 comes from `@fontsource/roboto`, and the icon font from `@fontsource/material-icons` (the same glyph set the app uses today, so no template changes; the plan suggested Material Symbols, which would have meant changing every icon). Both are listed in `angular.json` styles; `styles.scss` carries the standard `.material-icons` rule that Google's stylesheet used to provide. The Font Awesome 4.7 CDN is replaced by an inline SVG GitHub mark. The only external request left is the Gemini sparkle image in the book summary (`gstatic.com`, allowed by the backend CSP).

**Strict TypeScript.** `"strict": true` (it was `false`). Models `Book`, `ShoppingCart`, `Categories` are interfaces (nothing instantiated them); `@Input`s the parent always sets are `required`; forms use non-nullable controls; two template `?.` on a value that is always set were removed; the book form reads the chosen file safely (cancelling the file dialog used to throw); `my-orders` and the login response are typed. No explicit `any` is left.

Result: `npm run build` passes; initial total 1.09 MB raw / 240.8 kB transfer (the extra ~10 kB is the `@font-face` rules for Roboto's language subsets; the font files load only when a page needs them). The budget warning remains (F6).

## F1: security

Already done by the backend phases, so only verified here: no user id anywhere in the client, the guest cart is the server's cookie and is merged at login, the Gemini key and `@google/genai` are gone (the summary calls `POST api/book/{id}/summary`), checkout posts nothing.

**One place for the token: `services/token-storage.service.ts`.** Nothing else touches `localStorage` (checked by grep). It decodes the JWT payload correctly (base64url, UTF-8; plain `atob` broke on `-` and `_`), treats a malformed or **expired** token as no token (and removes it), and builds the signed-in `User` from it. Moving to another storage later is a change to this file only.

**Session restore.** `AppComponent` dispatches `restoreSession` (it used to dispatch a fake `loginSuccess`, which briefly flagged everyone as signed in). The effect sets the user from a valid stored token, or `sessionResolved` for a guest. The auth state has a new `authResolved` flag and selectors `selectAuthResolved`, `selectIsAdmin`.

**Route guards** are functions (`authGuard`, `adminGuard`) that wait for `authResolved` and return a `UrlTree`, so a hard refresh on a protected page no longer races the session restore.
- Not signed in: to `/login?returnUrl=<where they were going>`.
- `admin/books` uses `canMatch`, which replaces `canLoad` + `canActivate`: the admin code is not even downloaded for anyone else. A signed-in non-admin goes to `/` (the plan sent everyone to login; sending a signed-in user to a login page is confusing), a visitor who is not signed in goes to login with the return URL.

**HTTP interceptors** are `authTokenInterceptor` and `errorInterceptor` (camelCase). The error one keeps the real `HttpErrorResponse` instead of flattening it to a string, and:
- a **401** (except from `/api/login`, which is a wrong password) dispatches `sessionExpired`: the token is removed, the cart/wishlist/order/auth state is reset, a message "Your session has expired" shows if there was a session, and the visitor goes to login with the return URL. **No `location.reload()`.**
- 403 and 5xx show a message; 404 no longer redirects to the not-found page (the wildcard route already handles bad URLs).
- Effects store failures through `errorText(error)` (`shared/http-error.ts`), which prefers the API's problem-details text, so state never holds an error object.

**Login page.** A 401 from the login call is `INVALID_CREDENTIALS` (the check used to be `error.includes("Unauthorized")` on a flattened message); any other failure (rate limit, server error) now shows "Login failed: <reason>" instead of nothing. The return URL is validated (`shared/return-url.ts`: a path inside the app, not `//evil.com`) and followed with `navigateByUrl` (the old `navigate([url])` encoded a `?` in the return URL).

**Smaller.** The GitHub link has `rel="noopener noreferrer"`; logout and session expiry reset the order slice too (it kept the previous user's orders in memory); `placeOrder` takes no payload.

## Browser smoke test: `scripts/smoke`

A Chrome click-through of the real app, kept outside the app's dependencies (`puppeteer-core`, drives the installed Chrome). Needs the backend on `https://localhost:7073` against LocalDB `BookDB_Dev` and the dev server on `https://localhost:53424`:

```
dotnet run --no-launch-profile          # in BookCart/, with ASPNETCORE_URLS=https://localhost:7073 and Development
npm start                               # in BookCart/ClientApp (ASPNETCORE_HTTPS_PORT=7073)
cd scripts/smoke && npm install && node smoke.js --expect-f1
```

It seeds an admin and three books through the API, then checks: home and the self-hosted fonts, guest add to cart, search (with Enter), details page, registration (taken name flagged, new user), login merging the guest cart, cart page, checkout and My Orders, wishlist, a non-admin on `/admin/books`, logout, logged-out admin route, wrong password, off-site `returnUrl`, session expiry without a page reload, an expired token, admin list / hard refresh / edit form. It also reports console errors, HTTP statuses of 400 or more and external requests. Result on the F1 code: **21 of 21**; the only console errors are the two expected 401s. Against the untouched original code the same run finds the Enter-key search bug and loads fonts from Google and a CDN.

## F2: test infrastructure

**Runner (the plan's Karma bridge, which works on Angular 20; replaced by Vitest in F3.4 below).** `karma.conf.js` is rewritten (Jasmine, headless Chrome, plus a `ChromeHeadlessCI` launcher without Chrome's sandbox for containers), `src/test.ts` and the `main` entry in `angular.json` are gone (the builder finds `*.spec.ts` itself), `tsconfig.spec.json` is simplified, `@angular/platform-browser-dynamic` is uninstalled. `npm test` is one headless run; `npm run test:watch` keeps a visible Chrome open. The 36 generated "should create" specs are deleted.

**150 specs**, passing in random order (checked repeatedly). Where the logic lives:

| Area | Specs |
|---|---|
| Helpers | `safeReturnUrl`, `errorText`, JWT decoding and `TokenStorage` (expiry, malformed, role claim, base64url, non-ASCII) |
| Services | URL, verb and body of every API call (cart, wishlist, book, checkout, user, login); the user-name validator (debounce, cancel, encoding, failed lookup); the password rules |
| Reducers | auth (including `authResolved`), cart, wishlist, book, order |
| Selectors | price range, current book, badges, `selectIsAdmin` |
| Effects | auth (login, restore, expired session, logout), book, cart, wishlist, order, checkout, register |
| Guards, interceptors | both guards (waits, allows, redirects with the way back); the token header; 401, 403, 5xx, 404 and the login 401 |
| Components | book card, wishlist button, login, checkout, shopping cart, registration, search (with a regression test for the Enter-key bug) |

Specs build their data with `src/app/testing/fixtures.ts` and `helpers.ts` and use the real reducers where a store is needed.

**Found while writing them.** A `MockStore` selector override is global and leaked between specs (a guard test failed because an interceptor spec had overridden `selectIsAuthenticated`). Every spec that overrides a selector resets it in `afterEach`; this is also in `CLAUDE.md`.

**Mutation check (the plan's "break a reducer on purpose").** Fifteen behaviours were broken one at a time in the app code, the tests run, and the file restored: the auth, cart and order reducers, the cart badge, the Enter-key search bug, token expiry, the login 401, both guards, the off-site return URL, the book refetch, the checkout cart reload, URL encoding and the debounce of the name check, and the wishlist button. **All 15 were caught** (one to three failing tests each). The script backs up every file, restores in a `finally`, on exit and on Ctrl+C, and compares byte-for-byte at the end. It is not in the repo because it edits source files.

**CI.** The frontend job in `.github/workflows/ci.yml` now runs `npx ng test --watch=false --browsers=ChromeHeadlessCI` before the build. The plan suggested a separate `frontend.yml`; the existing job already has the checkout, Node and `npm ci` steps. It has not run on GitHub yet.

**Not covered.** `my-orders`, `nav-bar`, `home`, `book-details`, `book-summary`, the admin pages, and the categories and similar-books effects have no specs. The Vitest switch is F3.4 in the plan; the specs use Jasmine's `spyOn` and `jasmine.Spy`, which that step has to translate.

## F3: upgrade to Angular 22

Angular 20.1 to **22.2.2**, NgRx 19 to **22.0.1**, Material/CDK 20 to **22.2.2**, TypeScript 5.8 to **6.0.3**, Karma/Jasmine to **Vitest 5**. rxjs (7.8.2) and zone.js (0.15) are unchanged. Done on one working tree, so the plan's "one commit per major version" is yours to cut: the Angular 21 state is reproducible with `ng update ...@21` and was verified before moving on (build, 150 specs and the smoke test all passed on 21 as well as on 22).

**The upgrade itself**
- One `ng update` per major, covering core, CLI, Material, CDK and every NgRx package together. The plan runs them as three commands, but NgRx 19 peers on Angular 19 and would have blocked the first; together they resolve cleanly. The second hop needed `--allow-dirty` (nothing is committed between the hops).
- What the migrations changed in the code, all behaviour-preserving: `provideZoneChangeDetection()` in `main.ts` (Angular 21 made zoneless the default; this app still relies on zone.js until F4); `ChangeDetectionStrategy.Eager` on the two components that used the default (Angular 22 makes OnPush the default; F4.6 converts them to OnPush); `withXhr()` on the HTTP client (Angular 22 defaults to `fetch`; F6 switches on purpose); the template migration found nothing to convert.
- TypeScript 6 deprecates `baseUrl`, so `tsconfig.json` uses `paths: { "src/app/*": ["./src/app/*"] }` instead. All `src/app/...` imports are unchanged (the plan's other option was a codemod to `@app/` imports).
- The new `CanMatchFn` takes a third argument; one spec call was updated.
- Angular 22 would have warned about `?.` and `??` on values that cannot be null; the migration suppresses those two diagnostics, and they were turned back on: the build reports nothing.

**F3.3 cleanup**
- `@angular/animations` and `provideAnimations()` are gone. The My Orders row now opens and closes with a CSS grid-rows transition (same 225 ms curve), hidden from the keyboard and screen readers while closed, and without motion for `prefers-reduced-motion`. The smoke test checks it.
- `experimentalDecorators` and `useDefineForClassFields: false` are removed from `tsconfig.json`; the empty `src/assets` and its `angular.json` entries are gone (`environments/` and `fileReplacements` went in F0).
- `.npmrc` stays, for a different reason. A strict `npm ci` now fails only because the lock file lacks `@popperjs/core`, a peer of Bootstrap's JavaScript, which this app does not use. It goes with Bootstrap in F6.
- Node 24 is pinned in CI (Angular 22's CLI needs Node `^24.15` or `^22.22.3`).

**F3.4 Vitest** (replaces the F2 Karma bridge)
- Angular's own migrations did the work: `ng update @angular/cli --name migrate-karma-to-vitest` for the builder and `ng g @schematics/angular:refactor-jasmine-vitest` for the 15 spec files that used Jasmine APIs (report: zero manual TODOs). Karma, Jasmine, `karma.conf.js` and `istanbul-lib-instrument` are removed; `vitest` and `jsdom` are added. `npm test` is `ng test --no-watch`; `npm run test:watch` is `ng test`. No browser is needed anymore, in CI either.
- What still needed hand work: the schematic took my local helper `fail(...)` for Jasmine's global and rewrote the calls (renamed `failWith`, statuses restored); `fakeAsync` does not work under Vitest (no zone ProxyZone), so the two specs that wait out the half-second name check use `vi.useFakeTimers()`; the `store.dispatch` stubs are plain spies (NgRx 22's `dispatch` has a signal overload that the generated `mockReturnValue(undefined)` does not type-check against); the converted files were re-indented from 4 to 2 spaces to match `.editorconfig`.
- **Mutation check repeated on Vitest:** the same 15 deliberate breakages, all caught (14 in the script run; one run captured no output because of a harness glitch and was reproduced by hand: two specs fail). Files restored byte-for-byte.

**Result**
| | Angular 20 (F2) | Angular 22 (F3) |
|---|---|---|
| Initial bundle | 1.10 MB raw / 242 kB transfer | 1.09 MB raw / 225.8 kB transfer |
| Unit tests | 150, Karma + headless Chrome | 150, Vitest + jsdom (16 s for the run) |
| Smoke test | 21 of 21 | 22 of 22 (new: My Orders row opens and closes) |

Raw size along the way: 1.10 MB (Angular 20), 1.13 MB (21), 1.16 MB (22), then 1.09 MB after the cleanup step, which removed the animations package together with the two tsconfig options (not measured separately). The transferred size stayed near 242 kB until that step.

## Differences from the plan

| Plan said | Done | Why |
|---|---|---|
| Material Symbols variable font | `@fontsource/material-icons` | Same glyphs as the app uses now; Material Symbols would need every `mat-icon` changed |
| Delete `environments/` in F3.3 | Done in F0 | Its only use was `enableProdMode` |
| Admin guard sends a non-admin to login | A signed-in non-admin goes home | Not a login problem |
| Guard example calls `inject(Store)` inside operators | Injected once at the top | `inject` only works in the injection context |
| Replace guest cart id in F1.4 | Nothing to do | The backend phases did it |

## Open items

| # | Item | Belongs to |
|---|---|---|
| 1 | Token transport is still `localStorage` (readable by any script). The plan's target is an HttpOnly cookie, which needs backend work (set the cookie at login, `SameSite=Strict`, antiforgery for state-changing calls); `TokenStorage` and the interceptors are the only places to change. | Backend + F1 follow-up |
| 2 | The initial bundle is 1.10 MB against the 1 MB budget. | F6 |
| 3 | No specs for `my-orders`, `nav-bar`, `home`, `book-details`, `book-summary`, the admin pages and two effects; the CI test step has not run on GitHub. | F2 follow-up |
| 4 | `book-summary` still loads the Gemini sparkle image from `gstatic.com`. | F6 |
| 5 | `withXhr()`, `provideZoneChangeDetection()` and `ChangeDetectionStrategy.Eager` (added by the Angular 22 migrations to keep today's behaviour) stay until F6 (`withFetch()`) and F4 (zoneless, OnPush). | F4, F6 |
