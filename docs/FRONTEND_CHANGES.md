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
| F4 | Signals, smart/dumb components, zoneless | Done |
| F5 | State management: classic NgRx to SignalStore | Done |
| F6 | Material 3 theme, Tailwind, responsive layout, images, accessibility | Done |
| F7 | Hydration and build-time prerendering (no Node at run time) | Done (optional phase) |

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

## F4: signals, smart/dumb components, zoneless

Branch `modernize/f4-signals` (created by the repo owner).

**F4.5 router inputs first** (it unblocked the rest)
- `withComponentInputBinding()`: route and query parameters arrive as inputs (`id`, `category`, `item`, `returnUrl`). `@ngrx/router-store` and `state/selectors/router.selectors.ts` are gone; `main.ts` has an empty `provideStore()` and the five feature registrations.
- `login` carries `returnUrl` in the action instead of reading it from the router state; `loadSimilarBooks` carries a `bookId`.

**F4.1 / F4.2 signal inputs, outputs, queries; no more `BehaviorSubject`**
- Every `@Input`/`@ViewChild` is `input()`/`viewChild()`; leaf components report clicks with `output()`.
- `SubscriptionService` (the price filter's `BehaviorSubject`) is deleted: the price filter is a signal on the home page. `searchValue` in manage-books and my-orders is a signal feeding a `computed` table data source.
- `linkedSignal` is used where a value must reset when its source changes: the AI summary resets when the book changes, the wishlist heart follows its input but flips at once on click.

**F4.4 smart/dumb split**

| Smart (talks to the store) | Dumb (inputs and outputs only) |
|---|---|
| `home`, `book-details`, `nav-bar`, `login`, `checkout`, `manage-books`, `my-orders`, `wishlist`, `shoppingcart`, new `book-form-page` | `book-card`, `book-filter`, `price-filter`, `search`, `addtocart`, `addtowishlist`, `similarbooks`, `book-summary`, `book-form` |

- `book-summary` no longer calls the API; `book-details` does and passes the text, a loading flag and an error down. A late answer for a book the page has moved away from is dropped.
- `search` reports `searched` / `cleared`; the nav bar navigates. The outputs are not called `search`: that is also a DOM event of the inner `<input type="search">` and it **bubbles**, so the nav bar received the raw `Event` and searched for `[object Event]`. The smoke test found it; a nav-bar spec pins it.
- `book-form` (add/edit) takes `book` and `categories` and emits `save` (`{ formData, isUpdate }`) and `cancel`. The routed `book-form-page` finds the book from the `:id` input, loads books and categories, and dispatches add/update/cancel.

**F4.3 `selectSignal` was done only where a component was rewritten anyway** (the plan says to skip slices that F5 moves). These five still use `store.select` with the async pipe and move with their slice in F5: `nav-bar` (`userState$`), `book-details` (`bookDetails$`), `shoppingcart` (`cartItems$`), `wishlist` (`wishlistItems$`), `delete-book` (`bookData$`). `manage-books` and `my-orders` already read with `selectSignal`; `book-form-page` and the two guards keep `select` on purpose (they need an observable for `switchMap`).

**F4.6 zoneless**
- `provideZonelessChangeDetection()`; `zone.js` is uninstalled, `src/polyfills.ts` is deleted, and the `polyfills` entries are gone from `angular.json` (build and test) and `tsconfig.app.json`. `AppComponent` is `OnPush` (the `Eager` the Angular 22 migration added is gone everywhere).
- Audit: the only async callbacks that change component state are the book form's `FileReader.onload` and the summary request; both set signals. No component mutates a plain field after an async call. No `ExpressionChangedAfterItHasBeenChecked` or other console error in the smoke run.

**Bugs fixed on the way**
- A refresh on `/admin/books/<id>` showed an empty "Add" form (the page had no books yet), and saving it created a second copy of the book. The page now loads the books and categories itself (the smoke step "admin edit page by address" covers it).
- The home page's spinner no longer flashes when books are reloaded in the background.
- Enter in the search box still searches, and the browser's own `search` event no longer sends a visitor home when the box has text (spec in `search.component.spec.ts`).

**Result**
| | Angular 22 (F3) | F4 |
|---|---|---|
| Initial bundle | 1.09 MB raw / 224.7 kB transfer | 1.05 MB raw / 213.0 kB transfer (zone.js and router-store gone; still 51 kB over the 1 MB budget, F6) |
| Unit tests | 150 | 206 (new: home, book-details, nav-bar, book-form, book-form-page, search, and the dumb components) |
| Smoke test | 22 of 22 | 25 of 25 (new: details page by click and by address, admin edit page by address) |

`ng build` reports no template warnings; `ngc` on the spec config is clean.

### F4 follow-ups (what is left over, and where to pick it up)

Status after F5: F4-1 and F4-2 are done in F5 (every component reads signals; the search box text comes from the address). F4-3 is partly done (`my-orders` and `manage-books` have specs now; `book-summary`, `delete-book`, `wishlist` and `page-not-found` still have none). F4-4 was repeated in F5 on the new stores (24 of 24 caught). F4-7 was fixed in F6 (the default cover is 8 KB and the dev console no longer warns NG0913); F4-5, F4-6, F4-8 and F4-9 are open. Each row says what to do, so a later session can start without re-deriving it.

| # | Left over | What to do | Belongs to |
|---|---|---|---|
| F4-1 | Five components still use `store.select` + async pipe: `nav-bar` (`userState$`, `combineLatest` of auth, user, wishlist count, cart count), `book-details` (`bookDetails$`), `shoppingcart`, `wishlist`, `delete-book`. | Replace with `selectSignal` + `computed` and drop `AsyncPipe`. When the slice moves to SignalStore (cart and wishlist early, auth last) read the store's signals instead. Leave the guards and `book-form-page` alone. | F5, slice by slice |
| F4-2 | The search text is kept in the store (`setSearchItemValue`, `resetSearchItemValue`, `selectSearchItemValue`) only so the nav bar's box shows what the home page filtered by; `home` writes it from an effect. | When the books slice is rewritten, drop it: the nav bar can read the `item` query parameter from the router (or a small shared signal) and `home` stops dispatching from an effect. | F5 (books slice) |
| F4-3 | No specs yet for `manage-books`, `my-orders`, `book-summary`, `delete-book`, `wishlist` and `page-not-found`. | Follow the pattern of `home.component.spec.ts` (real store with the needed reducers, or `provideMockStore` with `resetSelectors()` in `afterEach`). Worth testing: the table filter and paging of `manage-books` and `my-orders`, the row toggle, `book-summary` showing spinner, text or error. | F2 follow-up |
| F4-4 | The mutation check (15 deliberate breakages, all caught after F3) was not repeated on the code F4 added. | Adapt `mutate-vitest.js` (it backs up each file and restores it in a `finally`, never run it without that) with breakages in: the `home` filters and price filter, `book-details` summary reset and late answer, `search` Enter and `search` event, `book-form` pristine check and `isUpdate`, `book-form-page` loads. | F2 follow-up |
| F4-5 | The "no `ExpressionChangedAfterItHasBeenChecked` with zoneless" check is a reading of the code plus a smoke run: the smoke test prints console errors but does not fail on them. | Make the smoke test fail on any console error other than the deliberate 401s (login with a wrong password, expired session), including `NG0100`. | F2 follow-up |
| F4-6 | `scripts/smoke/smoke.js` still has the `known` flag and `--expect-f1` option; every step is required now (the last flagged step, the edit page by address, passes). The helper that starts the backend and the dev server, runs the test and stops them is not in the repo. | Remove the flag and the option, and add that helper as `scripts/smoke/run.sh` (the README section above describes the manual steps). | Cleanup |
| F4-7 | The dev console warns NG0913 for `Default_image.jpg`: its file is much larger than the card it is drawn in. | `NgOptimizedImage` with width and height, and resized covers from the backend (plan B4 item). | F6 |
| F4-8 | `SearchComponent.suggestions` is `protected`, so its spec reads it through a cast. | Make it a public `readonly` or test through the rendered options. | Cleanup |
| F4-9 | The book form checks nothing about the chosen cover on the client (the API enforces `.jpg/.jpeg/.png/.webp`, 2 MB, matching content; a bad file is a 400). | Optional: check type and size before upload and show the message in the form. | Optional |


## F5: state management, classic NgRx to SignalStore

Branch `modernize/f5-signalstore` (created by the repo owner). `@ngrx/store`, `@ngrx/effects`, `@ngrx/entity` and `@ngrx/store-devtools` are uninstalled; `@ngrx/signals` is added and `@ngrx/operators` stays (for `tapResponse`). `src/app/state/{actions,reducers,selectors,effects}` (about 3,300 lines with their specs) are gone; each slice is one store file under `src/app/state/<slice>/`. `main.ts` registers nothing: every store is `providedIn: "root"`.

**Building block.** `shared/with-call-state.ts` adds `callState` (`"init" | "loading" | "loaded" | { error }`) to a store with `loading`, `loaded` and `error` (the text or null), and `setLoading()`, `setLoaded()`, `setError(text)`, `setInit()`. It replaces `shared/call-state.ts` (the `LoadingState` enum). `models/customtheme.ts` (unused) is deleted too.

| Store | State and what it does |
|---|---|
| `CategoriesStore` | `categories`; `load()` fetches once (a second call while loading or loaded sends nothing; after an error it retries). |
| `SimilarBooksStore` | `books`; `load(bookId)` takes a number or a signal of one (`book-details` passes its id signal), and moving to another book cancels the earlier request (`switchMap`). |
| `RegisterStore` | `register(details)`; success says so and goes to login, failure says to try again. |
| `BooksStore` | `withEntities` keyed by `bookId`; `priceRange` (one pass, no spread into `Math.min`); `load()` fetches once per session; `add`, `update`, `remove` change the list in place, say so, and `add`/`update` return to the admin list. `callState` is about fetching the list only. |
| `AuthStore` | `user`, `isAuthenticated`, `isAdmin`, `userId`; `login({ credentials, returnUrl })`, `logout()`, `expireSession()`, `resetLoginError()`. `callState` is the login attempt (`error()` is `INVALID_CREDENTIALS` for a 401). The stored token is read once when the store is created. |
| `CartStore` | `items`, `count` (copies), `total`; `load`, `add`, `remove`, `reduce`, `clear`. Loads when created (the guest's cart too) and again whenever someone signs in; signing out empties it. |
| `WishlistStore` | `items`, `count`, `ids`; `load`, `toggle`, `clear`. Loads on sign-in, empties on sign-out; a guest's call is refused locally with "User not found". |
| `OrdersStore` | `orders`; `load()`; empties on sign-out. |

**Session wiring.** `AuthStore` knows nothing about the others. `CartStore`, `WishlistStore` and `OrdersStore` watch `auth.userId()` in an `effect` inside `withHooks` and reload or empty themselves. That replaces `setAuthState`, `logout` and `sessionExpired` being handled in every reducer and effect. Because the token is read synchronously at creation, `restoreSession`, `sessionResolved`, `loginSuccess` and the `authResolved` flag no longer exist: the guards (`authGuard`, `adminGuard`) read `AuthStore` and answer at once, and `AppComponent` is empty (the nav bar creates the stores). `errorInterceptor` calls `auth.expireSession()`.

**Checkout has no store** (as the plan says). `CheckoutComponent` calls `CheckoutService.placeOrder()` and then shows the message, goes to My Orders and calls `cart.load()` (the server emptied the cart; the plan's `cart.clear()` would send a pointless DELETE). New: `placing` blocks a second submit and disables the button while the order is under way.

**Components.** All of them inject stores instead of `Store`: no `dispatch`, no selectors, no async pipe left (`nav-bar`, `book-details`, `shoppingcart`, `wishlist`, `delete-book` were the last). `book-form-page` finds its book with `entityMap()[id]` (no `toObservable`/`toSignal`). The nav bar reads the search text from the address (`?item=` of `/search`), so the store no longer holds it and `home` no longer writes it from an effect.

**Behaviour that changed on purpose**
- The catalogue and the categories are fetched once per session, not on every visit to home, a book page or manage-books (the plan, F5.3). Admin add, update and delete change the list in place.
- Admin add, update and delete no longer flip the list's `callState` to loading, so nothing flashes while the admin saves.
- The wishlist and My Orders pages still fetch each time they open.
- Checkout cannot be submitted twice while the first is under way.

**Result**
| | F4 | F5 |
|---|---|---|
| Initial bundle | 1.05 MB raw / 213.0 kB transfer (51 kB over budget) | 997.47 kB raw / 199.33 kB transfer, under the 1 MB budget |
| Unit tests | 206 | 224 (a spec per store, no `MockStore`) |
| Smoke test | 25 of 25 | 25 of 25 |
| Mutation check | n/a | 24 deliberate breakages of the new stores, guards, interceptor, checkout and nav bar: 23 caught at first; the one that escaped (the nav bar showing `?item=` on a page that is not the search page) got a test and is caught. Every file was restored byte for byte. |

**Network check** (guest, dev server): opening home sends one GET each for the cart, the books and the categories; adding a book sends one POST and nothing else; opening a book page sends only the similar-books GET (the books are already here); going back sends nothing. A full page load of `/shopping-cart` sends the cart GET twice (the store's start load and the page's own), as before.

**Testing pattern.** A store spec injects the real store with `provideHttpClient(withXhr())`, `provideHttpClientTesting()`, a stubbed router and `SnackbarStub`, and flushes the requests; stores that follow the session (cart, wishlist, orders) are driven through `TestBed.inject(AuthStore).login(...)` or `.logout()` and `TestBed.tick()` (that runs their effects). Component specs provide fakes from `src/app/testing/fake-stores.ts` and `fake-books-store.ts` (the same signals, with spies for the methods) and change what the component shows by setting a signal.

### F5 follow-ups

| # | Left over | What to do | Belongs to |
|---|---|---|---|
| F5-1 | No devtools for the stores (they went with `@ngrx/store-devtools`). | Optional: `@angular-architects/ngrx-toolkit` `withDevtools()` in dev builds only. | Optional |
| F5-2 | The catalogue is fetched once per session, so a book another admin changes shows only after a reload. The server caches it for 5 minutes anyway. | If it matters: a `refresh()` in `BooksStore` called when manage-books opens or on a timer. | Optional |
| F5-3 | The plan's `filters` and `filtered` in the books store were not added: the filters are the route inputs and the price slider, and they live in `home`. | Keep; revisit only if a second page needs the same filtering. | Decision |
| F5-4 | A full load of `/shopping-cart` sends `GET /api/shoppingcart` twice (`CartStore` at start, then the page's `load()`). | Drop the page's `load()` (every cart call answers with the whole cart) or skip a load while one is under way. | Cleanup |
| F5-5 | A failed cart, wishlist or orders call records `error()`, but no page shows it (only the interceptor's 403 and 5xx messages show), as before F5. | Show `error()` on the page, or a snackbar from the store. | Optional |
| F5-6 | Every store is `providedIn: "root"`, so state stays after leaving a page (the similar books, the register status). Nothing needs a clean start today. | Reset in the page that needs one. | Note |

## F6: styling, layout, images, accessibility

Branch `modernize/f6-ui` (created by the repo owner). Bootstrap is uninstalled (so is `ClientApp/.npmrc`, which only existed for its peer dependency; `npm ci --dry-run` is clean without it); `tailwindcss`, `@tailwindcss/postcss` and `postcss` are added as dev dependencies.

**F6.1 Material 3 theme**
- `src/styles/theme.scss` is the one theme: `mat.theme` with a violet primary and an orange tertiary palette (changed from azure and rose to make the app colourful: see "Vibrant theme" below), Roboto, `color-scheme: light dark`. Dark mode follows the system setting and needs no code. It replaces the `indigo-pink.css` prebuilt theme in `angular.json` (build and test).
- Every colour in the styles is a `--mat-sys-*` token now (the 20 hard-coded colour codes, including `#ff4081`, `#b30000`, `#fafafa`, are gone; a grep finds none). The pink banner of a page card is the tertiary container (`.custom-card-header`), the chosen category is Material's own "activated" state, the wishlist heart is `--mat-sys-error`.
- Buttons use the Material 3 API: `matButton="filled|tonal|outlined|text"` and `matIconButton`. M3 buttons have no `color="warn"`, so a destructive button is `class="danger"` (it sets the button's colour tokens). Cancel buttons are outlined, buttons that navigate are `<a matButton>`. `mat-elevation-z*` classes became `shadow-level-1..5` (the M3 elevation tokens), `mat-h1`/`mat-h4` became `.card-heading`/`.card-subheading`.

**F6.2 Tailwind v4 instead of Bootstrap**
- Tailwind is utilities only (`src/styles/tailwind.css`, `.postcssrc.json`), with **no preflight**: its reset restyles buttons, inputs and tables that Material already styles. The few reset rules the app needs (box-sizing, margins, links) are in `src/styles.scss`. The Tailwind theme replaces its palette and shadows with the Material tokens, so `bg-primary`, `text-on-surface` and `shadow-level-2` follow the theme and dark mode.
- **Bootstrap's spacing scale is not Tailwind's** (Bootstrap `my-4` is 1.5rem, Tailwind `my-4` is 1rem): the class conversion translated the numbers (1, 2 stay; 3 to 4; 4 to 6; 5 to 12) instead of copying them. The `row`/`col-*` grids became CSS grid (`md:grid-cols-...`).
- **Gotcha:** Tailwind utilities sit in a cascade layer and Material's component CSS is unlayered, so a utility on a Material host loses when Material sets the same property. `mat-card-content` is `display: block` with its own padding, so a `grid` class on it did nothing (the details page showed a stacked layout until the grid moved to a `div` inside). `mat-card-header.custom-card-header` has the element name to beat Material's padding.

**F6.3 Responsive layout**
- Nav bar: a sticky `header` (no more `padding-top: 60px` for a fixed bar). Below 1024 px (`BreakpointObserver`) the links collapse into a menu button, the search box moves to a row of its own, and the cart (and wishlist) icons stay. The badges sit on the buttons and the buttons are named ("Shopping cart, 5 items").
- Login, register and checkout are fluid (`w-full max-w-xl mx-auto`, not a fixed half width). The book grids are two columns on a phone and fill the width above it. The side filters stack above the books on a phone.
- The cart and the wishlist are lists, not tables (a six-column table cannot work at 360 px): picture, title and price, then the controls, which drop under the title on a phone. The admin books table, My Orders and the checkout summary scroll sideways inside their card.

**F6.4 Images**
- Pictures are `NgOptimizedImage` (`ngSrc` with `fill` inside a box with a fixed aspect ratio, so nothing jumps: CLS is 0), with real `alt` text ("<title> cover"). The first six cards, the first cart and wishlist thumbnail and the details cover are `priority`; the rest load lazily. A test found a real bug here: `priority` must not change while an image exists, so the home grid is keyed by place and the cart and wishlist gate the first row with `@if`.
- `wwwroot/Upload/Default_image.jpg` was 1205 x 1843 px and 218 KB for a picture drawn about 180 px wide; it is 400 x 612 and 8 KB now (the backend only checks that it is served as a JPEG). Covers that admins upload are still stored full size (F6-3).

**F6.5 Loading and bundle**
- `SelectivePreloadingStrategy` replaces `PreloadAllModules`: lazy routes load in the background except `data: { preload: false }` (`admin/books`), so visitors do not download the admin pages.
- `@defer (on viewport)` for the similar books on the details page (the AI summary is a button, nothing to defer).
- The home grid has a `mat-paginator` (12, 24 or 48 books per page, back to page 1 when a filter changes what is listed). It pages the filtered list in the browser (F6-4).
- `withFetch()` is explicit in `main.ts` (the XHR the Angular 22 migrations kept is gone). The budgets are 950 kB warning and 1.2 MB error for the initial bundle (the plan's 500 kB is not reachable without SSR; this catches regressions).
- The Gemini button uses the `auto_awesome` icon instead of an image loaded from `gstatic.com`: the app makes no external request any more (the smoke test checks).

**F6.6 Accessibility**
- axe-core on ten pages (guest and signed-in), light and dark, 360 and 1280 px: **900 violating nodes before, 0 after.** Before: 619 content outside landmarks, 75 icons without a name, 52 unnamed buttons, 40 pages without a main landmark and 40 without an h1, 35 invalid aria attributes, 27 colour contrast, 8 images without alt, 4 unlabelled inputs.
- What changed: `header`, `main` and a skip link; one `h1` per page (the page card's title; the home page has a visually hidden one); every icon button names its book or action (a visible label is contained in its accessible name); the category list, the "show password" icons, the wishlist heart and the cover upload are real links and buttons (they were clickable `div`s and `span`s that a keyboard could not reach); My Orders rows are focusable and open with Enter or Space (`aria-expanded`); the search box has a visible focus ring; the price slider has a label; heart and card animations stop under `prefers-reduced-motion`.

**Result**
| | F5 | F6 |
|---|---|---|
| Initial bundle | 997.47 kB raw / 199.33 kB transfer | 900.16 kB raw / 202.47 kB transfer (CSS is 7.9 kB theme + 6.0 kB Tailwind) |
| Unit tests | 224 | 240 |
| Smoke test | 25 of 25 | 25 of 25 (no external requests; selectors updated for the new markup) |
| axe violations | 900 nodes | 0 |
| Lighthouse, mobile (production build) | not measured | home 73, details 72, login 79 for performance; **accessibility 100, best practices 100, CLS 0** on all three. FCP 3.4 to 3.9 s, LCP 3.8 to 4.5 s, TBT 160 to 260 ms on the simulated slow 4G. |

Screenshots at 360, 768 and 1280 px in light and dark were taken before and after for ten pages and checked by eye (kept outside the repo).

### F6 follow-ups

| # | Left over | What to do | Belongs to |
|---|---|---|---|
| F6-1 | There is no Lighthouse baseline from before F6 (F0 never recorded one); only the axe and bundle numbers were captured first. | Nothing now; re-measure after F7 or any large change and keep the numbers. | Note |
| F6-2 | Performance is 72 to 79: the app is client-rendered (HTML, then JS, then the API, then paint), and the Material Icons font is 126 kB. | F7 (SSR) is the lever. Cheaper: replace the icon font by SVG icons (`MatIconRegistry`) or a subset. | F7, optional |
| F6-3 | Covers admins upload are stored full size, so the `NgOptimizedImage` pictures cannot be smaller than the file. | Backend: an image resize endpoint or thumbnails at upload, then an image loader with `srcset`. | Backend, optional |
| F6-4 | The home paginator pages in the browser; the whole catalogue is still fetched once. | Server paging with `GET api/book/search` (page, pageSize, filters) would cut the first load, but changes `BooksStore` and the search suggestions. | Optional |
| F6-5 | On a phone the category list takes about a screen above the books. | Collapse it into a select or an accordion below 768 px. | Optional |
| F6-6 | Dark mode follows the system only. | A toggle that sets `color-scheme` on `html`, if wanted. | Optional |
| F6-7 | The screenshot, axe and Lighthouse tooling is not in the repo (it lives in a scratch folder). | Add `scripts/smoke/shots.js` with `axe-core` and make the smoke test fail on any axe violation. | Cleanup |
| F6-8 | The admin book form's cover preview is a plain `img` (it shows a local file, which `NgOptimizedImage` does not take). | None. | Note |


## F7: hydration and build-time prerendering

Branch `modernize/f7-ssr` (created by the repo owner). **Approach chosen by the repo owner** (the plan makes F7 optional and warns it changes hosting): hydration plus prerendering of the public pages at build time, with **no Node process at run time**. ASP.NET still only serves static files, `SpaProxy`, `dotnet publish` and `PublishContainer` work as before. The alternative (a real Node SSR server behind ASP.NET, so that crawlers get the catalogue and book pages with their data) was not built; F7-1 says what it would take.

**What is drawn at build time:** `/`, `/login` and `/register` (`app.routes.server.ts`, `outputMode: "static"`). Home is its frame (header, filters, the "Books" heading, a spinner): the books come from the API in the browser. Every other route is `RenderMode.Client`: it is served as the empty shell `index.csr.html`.

**App changes**
- `app/app.config.ts` holds the providers that `main.ts` used to hold (`main.ts` is three lines now); `app.config.server.ts`, `main.server.ts` and `app.routes.server.ts` are the build-only part. `@angular/ssr` and `@angular/platform-server` are pinned to 22.2.2 with the rest of Angular. The schematic's Express `server.ts` is not used (removed, with `express`).
- `provideClientHydration(withNoIncrementalHydration())`: the running app takes over the drawn page instead of drawing it again. Event replay (and with it incremental hydration) is off: Angular puts an inline script in every page for it, which the Content-Security-Policy (`script-src 'self'`) blocks. The plan's `withEventReplay()` was therefore not used.
- `TokenStorage` does nothing outside the browser (the guard the plan asks for): there is no `localStorage` while a page is drawn, so nobody is signed in then.
- `noApiOnServerInterceptor`: while a page is drawn, a call to `/api/...` ends with no answer (there is no API to ask at build time). The page is drawn in its "loading" state, which is also how the browser starts, so the app takes it over without a difference.
- The nav bar's layout is CSS now (a grid with one media query at 1024 px) instead of `BreakpointObserver`. The drawn page cannot know the screen width, and the first version (width asked by a script) made the nav jump from one row to two on a phone when the app took over (CLS 0.03). One search box, the wide links and the narrow menu button are all in the page; CSS shows the right ones.

**Host changes**
- `PipelineExtensions`: a drawn page is served at its own address (`/login` serves `login/index.html`, `/` serves the drawn `index.html`); every other page route gets `index.csr.html` (or `index.html` for a build without drawn pages). Without this, a deep link such as `/wishlist` would have received the drawn home page, which cannot be taken over on another address. A backend test covers it (the three mutations that matter were caught; the fourth, the "no file extension" guard, is an equivalent mutant).
- The publish target copies `dist/browser` keeping its folders (see the defects below).

### Defects found while confirming F6 (fixed on this branch)

Re-checking F6 against a real `dotnet publish` (the dev server and the unit tests had hidden them):
1. **Every font was a 404 in a published build.** The publish target flattened `dist/` into `wwwroot` (`wwwroot\%(FileName)%(Extension)`) while the CSS asks for `media/roboto-....woff2`. Since F0 (self-hosted fonts) Roboto fell back to a system font; since F6 the Material icons (the cart, the menu) would have shown as their names ("shopping_cart"). Fixed by keeping the relative paths (`%(RecursiveDir)`) and publishing only `dist/browser`.
2. **A CSP violation on every page:** Angular's critical-CSS inlining adds an `onload` handler to a link tag, which `script-src 'self'` forbids. `inlineCritical` is off in the production build.
3. **The CSP still allowed Google Fonts, the Bootstrap CDN and gstatic**, none of which the app uses any more. They are gone from the policy (`PipelineExtensions`). A check of the published app against the policy now reports **no violations** on five routes, so `Security:EnforceCsp` can be switched on if you wish (it is still report-only by default).
4. Small leftovers: a Bootstrap `display-4` class on the details page, and three statements that still described `.npmrc`, Bootstrap or `withXhr()` (`README.md`, `ci.yml`, `CLAUDE.md`).
5. A guard so it cannot come back: `npm run verify:dist` (`verify-static.js`, run by CI after the production build) checks that every file the pages and the CSS refer to exists and that no page has an inline script or event-handler attribute. It also works on a publish folder (`node verify-static.js <publish>/wwwroot`); it fails on the two broken outputs above.

**Result**
| | F6 | F7 |
|---|---|---|
| Initial bundle | 900.2 kB raw / 202.5 kB transfer | 927.7 kB raw / 211.1 kB transfer (+27.5 kB: the hydration runtime) |
| Unit tests | 240 | 244 |
| Backend tests | 207 | 208 (the serving rules) |
| Smoke test | 25 of 25 (dev server) | 25 of 25 on the dev server **and** on the production build served by the real backend (the script takes `API` and `WEB` from the environment now) |
| axe | 0 (10 pages; 12 interactive states: errors, empty pages, menus, dialog, paginator) | 0 on the production build (the same 10 pages, 360 and 1280 px, light and dark) |
| First paint, measured in Chrome without throttling (warm, 4 runs) | login 156-264 ms, home 264-288 ms; **no JavaScript: nothing is painted** | login 72-208 ms, home 68-212 ms; **no JavaScript: the page is painted at about 70-90 ms** |
| Lighthouse, mobile, simulated slow 4G (home / details / login) | 61 / 61 / 60, FCP 4.3-4.4 s | 62 / 54 / 56, FCP 4.2-4.6 s: **no measurable change**. Accessibility 100, best practices 100, CLS 0 |

Lighthouse's simulated numbers vary by 10 points or more between runs on this machine (the same F6 build scored 61 and 73 in two harnesses), and its model keeps the render-blocking stylesheets and the font chain on the path either way, so it cannot show a gain of this size. What F7 changes is what a visitor sees first: with JavaScript off, or before the bundle has arrived, the three public pages are there instead of a blank page.

Hydration was checked in a development build (mismatches are only reported there): at 360 and 1280 px, as a guest and as a signed-in admin, on six routes, with "Angular hydrated N components, 0 skipped" and no warnings.

### F7 follow-ups

| # | Left over | What to do | Belongs to |
|---|---|---|---|
| F7-1 | This is not server-side rendering of data: the book pages and the catalogue are still filled in by the browser, so a crawler that does not run JavaScript sees the frame and the h1 only. | If SEO of the book pages matters: `outputMode: "server"` (a Node process running the `@angular/ssr` server), ASP.NET forwarding page requests to it, Node added to the container image (the SDK container build has none), the books and categories fetched on the server (the interceptor would let `/api` through to the real API), and a transfer of that data to the browser. | Optional |
| F7-2 | A signed-in visitor receives the guest frame first (the nav says "Login" until the app takes over), then it changes. | Acceptable. A "signed in" hint cookie could draw the right nav, at the cost of a second source of truth. | Note |
| F7-3 | Text typed into the drawn login or register form before the app has taken over can be lost when it does (without event replay nothing restores it). | Rare (the bundle loads in a fraction of a second); fixing it means event replay, which needs a CSP hash or nonce for its inline script. | Note |
| F7-4 | `ng serve` (development) does not prerender; only the production build does. | Use `npm run build` and the backend to see the drawn pages. | Note |
| F7-5 | CI checks `dist/browser` (`verify:dist`), not the layout of a `dotnet publish` folder, so a regression in the publish target would only be caught by hand. | Run `node verify-static.js` on the publish folder in CI. | Cleanup |
| F7-6 | `Security:EnforceCsp` is still false (report-only), although the built app now produces no violations. | Switch it on in the deployment settings once you have looked at your own environment. | Decision |
| F7-7 | The screenshot, axe, state-check, hydration and Lighthouse scripts used for F6 and F7 are not in the repo (F6-7). | Add them under `scripts/` with `axe-core` as a dev dependency. | Cleanup |


## Vibrant theme (after F7)

The F6 theme was correct but looked black and white: near-white and near-black surfaces, with colour only on small controls. Chosen with the owner: violet primary, orange accent, bold, light and dark following the system.

- `src/styles/theme.scss`: `mat.$violet-palette` primary, `mat.$orange-palette` tertiary. It also defines `--bc-brand-gradient` (violet to orange, interpolated in oklch so it passes through magenta), `--bc-card-tint`, `--bc-accent` and `--bc-on-accent`. They are built from the `--mat-sys-*` tokens (and one palette tone), so there are still no colour codes in the styles.
- `src/styles.scss`: a violet wash and an orange glow behind the page; every `mat-card` takes `--bc-card-tint`; the page-card header band (`.custom-card-header`) uses the brand gradient.
- The nav bar, the book cards (tinted, violet border, violet glow on hover, orange prices), the category list (`bg-card`, a new Tailwind colour in `tailwind.css`) and the Add to Cart button (`--bc-accent`) follow.
- Contrast: both ends of the gradient have the same tone, so white (or dark, in dark mode) text keeps its contrast along it. In light mode the Material tertiary is a dark brown, so the button uses orange tone 70 with tone 10 text instead; prices stay on the tertiary token because a bright orange as text on a pale card is under 4.5:1.
- Checked with headless-Chrome screenshots of home, login, register and cart in light and dark mode, the 244 unit tests, the production build and `npm run verify:dist`. Not re-run: the browser smoke test and a Lighthouse pass. Phone width was not checked by screenshot (headless Chrome will not go below about 500 px wide); only colours changed, no layout rule did.

## Differences from the plan

| Plan said | Done | Why |
|---|---|---|
| Material Symbols variable font | `@fontsource/material-icons` | Same glyphs as the app uses now; Material Symbols would need every `mat-icon` changed |
| Delete `environments/` in F3.3 | Done in F0 | Its only use was `enableProdMode` |
| Admin guard sends a non-admin to login | A signed-in non-admin goes home | Not a login problem |
| Guard example calls `inject(Store)` inside operators | Injected once at the top | `inject` only works in the injection context |
| Replace guest cart id in F1.4 | Nothing to do | The backend phases did it |
| F4.3 `selectSignal` for all ~40 call sites | Only in components rewritten for F4 | The plan itself says slices that F5 migrates can skip it |
| F4.4 `book-form` becomes dumb | A new routed `book-form-page` holds the store code | Fixes the blank form on refresh |
| F5 slice order: categories, similar-books, register, order, wishlist, cart, books, auth | categories, similar-books, register, books, then auth with wishlist, cart and orders together | Those four react to sign-in and sign-out, so they cannot sit half on classic NgRx and half on stores; books and the first three do not depend on the session |
| F5.3 auth: `resolved` flag, `toObservable(auth.resolved)` in the guards | No `resolved` state; guards are synchronous | The stored token is read in `onInit`, so it is always "looked at" before anything renders |
| F5.3 checkout calls `cart.clear()` afterwards | Calls `cart.load()` | The server already emptied the cart; `clear()` would send a DELETE for nothing |
| F5.3 books store with `selectedId`, `filters`, `filtered` | Entities, price range and the mutation methods only | The filters come from the route inputs and stay in `home` (F5-3) |
| F5.4 optional `withDevtools` | Not added | F5-1 |
| F6.1 tertiary palette `mat.$magenta-palette` | `mat.$rose-palette` | Closer to the pink the app already had |
| F6.2 `@import "tailwindcss"` (with preflight) | Utilities only, no preflight | The reset restyles Material buttons, inputs and tables |
| F6.2 spacing classes map to the same numbers (`p-3` to `p-3`) | The numbers are translated | Bootstrap's spacing scale is different from Tailwind's |
| F6.5 pagination or virtual scroll "after backend B4.5" | A client-side `mat-paginator` (12, 24, 48) | The catalogue is fetched once anyway (F5); server paging is F6-4 |
| F6.5 `@defer` for `similarbooks` and `book-summary` | `similarbooks` only | The summary is one button, nothing to defer |
| F6.5 budgets 500 kB warning, 1 MB error | 950 kB warning, 1.2 MB error | The bundle is 900 kB; 500 kB needs SSR or less Material. This catches regressions |
| F6 verify: Lighthouse before and after | After only, with axe and bundle before and after | No baseline was ever recorded (F6-1) |
| F7 `provideClientHydration(withEventReplay())` | `withNoIncrementalHydration()`, no event replay | Its inline script is blocked by the CSP (F7-3) |
| F7 `ng add @angular/ssr` (Express `server.ts`, server output) | Static output (`outputMode: "static"`), no server file, no Express | The owner chose prerendering without a Node process (F7-1) |
| F7 "prerender only the public routes (home and details)" | Home, login, register | The details page is data (the book), which does not exist at build time |
| F6.3 `BreakpointObserver` for the nav | CSS grid with a media query | The drawn page cannot know the width; the observer made the nav jump (CLS) |

## Open items

| # | Item | Belongs to |
|---|---|---|
| 1 | Token transport is still `localStorage` (readable by any script). The plan's target is an HttpOnly cookie, which needs backend work (set the cookie at login, `SameSite=Strict`, antiforgery for state-changing calls); `TokenStorage` and the interceptors are the only places to change. | Backend + F1 follow-up |
| 2 | Done in F6: the initial bundle is 900 kB (1.10 MB before F4), the budgets are 950 kB and 1.2 MB. | Done |
| 3 | No specs for `book-summary`, `delete-book`, `wishlist` and `page-not-found` (the rest of F4-3); the mutation check was not repeated on the F4 components (it was run on the F5 stores, F4-4); the smoke test does not fail on console errors (F4-5); the CI test step has not run on GitHub. | F2 follow-up |
| 4 | Done in F6: the Gemini button uses a Material icon; no external request is left. | Done |
| 5 | Done in F6: HTTP goes through `fetch`. | Done |
| 6 | Done in F5: F4-1 (no async pipe left) and F4-2 (search text read from the address). | Done |
| 8 | The F5 follow-ups (F5-1 to F5-6), the F6 follow-ups (F6-1 to F6-8) and the F7 follow-ups (F7-1 to F7-7) above. | Optional |
| 7 | Smoke test cleanup: drop the `known` flag and `--expect-f1`, add the run helper to the repo (F4-6); Default_image NG0913 (F4-7); small test and form items (F4-8, F4-9). See the F4 follow-ups table. | Cleanup, F6 |
