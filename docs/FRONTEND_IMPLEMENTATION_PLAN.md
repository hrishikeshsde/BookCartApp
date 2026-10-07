# Frontend Implementation Plan: BookCart ClientApp (Angular 20 → 22)

Scope: `BookCart/ClientApp/`. Each phase is one branch and one PR, and each ends with a check you can run. Phase order: F0 hygiene → F1 security (coordinated with backend B0) → F2 tests → F3 upgrade → F4 signals/zoneless → F5 state → F6 styling → F7 optional SSR.

**Versions confirmed on the registry (checked today):**

| Package | Target |
|---|---|
| `@angular/*` (core, cli, material, cdk) | 22.2.1 |
| `@ngrx/*` (store, signals) | 22.0.1 (peer `@angular/core ^22`) |
| `typescript` | **6.0.x** (Angular 22's build requires `>=6.0 <6.1`), the one you have today is 5.8 |
| `rxjs` | 7.8.2 |
| `zone.js` | optional, `~0.15 \|\| ~0.16` if kept |
| Node | CLI 22 requires `^22.22.3 \|\| ^24.15 \|\| >=26`. You have **24.21**, so it's fine |
| Test runner | `@angular/build` supports `vitest ^4.0.8 \|\| ^5` and still lists `karma ^6.4` |
| `tailwindcss` | 4.3.x |

All commands run from `BookCart/ClientApp` unless stated. Windows PowerShell/Git Bash both work.

## Step 0: Before touching anything

```bash
cd D:/GitLocal/AnkitSharma/BookCartApp
git status --short                       # Program.cs, BookDB.txt, LICENSE modified; CLAUDE.md, docs/ untracked
git stash -u -m "wip-before-frontend" || true
git checkout -b modernize/f0-hygiene
cd BookCart/ClientApp
npm ci                                   # node_modules is not installed yet
npm run build                            # BASELINE: record whether this passes on Angular 20 today
```

If the baseline build fails, fix that first. You need to know the starting state. Keep the baseline bundle sizes (`dist/` output) to compare later.

---

## Phase F0: Hygiene and quick fixes (still Angular 20)

### F0.1 Dependency cleanup
```bash
npm uninstall ts-node @types/jasminewd2 jasmine-spec-reporter karma-coverage-istanbul-reporter run-script-os
npm install rxjs@~7.8.2
npm install -D @types/node@^24
```
`run-script-os` only serves the `start` script. Replace both `start:windows`/`start:default` with one cross-platform script, since `aspnetcore-https.js` already exports the cert:

```json
"start": "ng serve --port 53424 --ssl --ssl-cert $(node aspnetcore-https-path.js cert) ..."
```
Simplest correct version: keep `run-script-os` for now and revisit it in F3. It is low value to change.

### F0.2 Bug fixes found in the analysis

| File | Fix |
|---|---|
| `components/addtowishlist/addtowishlist.component.ts` | Subscription created on every `ngOnChanges`. Replace with a signal input + `computed`, or at minimum `takeUntilDestroyed` and one subscription |
| `services/book.service.ts` | URLs built like `` `${baseURL}/GetSimilarBooks/${id}` `` where `baseURL` already ends in `/` → `//`. Remove the extra slash |
| `models/user.ts` | `lastName: number` → `string` |
| `services/custom-validation.service.ts` | Doubled debounce (`setTimeout` + `debounceTime(1000)`) and no encoding. Use `timer(500).pipe(switchMap(() => http.get(`/api/user/validateUserName/${encodeURIComponent(name)}`)))` |
| `components/price-filter/price-filter.component.ts` | Pushes `event.target.value` (a string) into a `BehaviorSubject<number>`. Convert with `Number(...)` and type the event |
| `components/home/home.component.ts` | Dispatches `setSearchItemValue` inside a `map()`. Move it to a `tap` in an effect or to `ngOnInit` |
| `state/effects/checkout.effects.ts` | Dereferences a possibly-null user. Add a guard |
| `state/effects/book.effects.ts` | Refetches all books after add/update/delete although the reducer already applies the change. Remove the refetch |
| `state/effects/auth.effects.ts`, `book.effects.ts`, `similarbooks.component.ts` | Remove unused imports (`connect` from `http2`, `act`, unused `BookService`/`ActivatedRoute`/`switchMap`) |
| `components/search/search.component.html` | `track book` → `track book.bookId` |

### F0.3 `main.ts` cleanup
- Delete `importProvidersFrom(BrowserModule)` and `enableProdMode()` (plus `environment.production` if nothing else uses it).
- Merge the two `provideStore(...)` calls into one: `provideStore({ [ROUTER_FEATURE_KEY]: routerReducer })`.
- Delete the unused `PreloadingStrategy` import.

### F0.4 `index.html`
Remove the invalid `async` attribute on `<link>`, replace Font Awesome (only `fa-github` is used) with an inline SVG, and self-host fonts so a strict CSP is possible later:
```bash
npm install @fontsource/roboto @fontsource-variable/material-symbols-outlined     # or keep Google Fonts with preconnect
```
Import them in `styles.scss` and remove the `<link>` tags.

### F0.5 Turn on strict TypeScript, incrementally
In `tsconfig.json` set `"noImplicitAny": true` first, then `strictNullChecks`, then `"strict": true`. Fix errors per file. The `any`s are in `my-orders` (filterPredicate), `authentication.service.ts` (`post<any>`), `custom-validation.service.ts`, `auth.effects.ts` and `register.effects.ts`. Models (`models/*.ts`) are classes with uninitialised fields: convert to `interface`/`type`.

**Verify:** `npm run build` passes. Smoke test through the app (browse → add to cart → login → checkout). Commit.

---

## Phase F1: Security (coordinate with backend B0)

```bash
git checkout -b modernize/f1-security
```

**Ordering rule:** the backend B0 PR changes the auth contract (the `sub`/`role` claim, checkout payload, guest cart). Develop F1 against the B0 branch and merge both together.

### F1.1 Functional, correct guards
Replace `guards/auth.guard.ts` and `guards/admin-auth.guard.ts` with functional guards that wait for auth to resolve and return a `UrlTree`:

```ts
// guards/auth.guard.ts
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const store = inject(Store);
  return store.select(selectAuthResolved).pipe(
    filter(Boolean), take(1),
    switchMap(() => store.select(selectIsAuthenticated)),
    take(1),
    map((ok) => ok ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }))
  );
};

export const adminGuard: CanMatchFn = () => {   // canMatch replaces canLoad + canActivate
  const router = inject(Router);
  return inject(Store).select(selectAuthResolved).pipe(
    filter(Boolean), take(1),
    switchMap(() => inject(Store).select(selectIsAdmin)), take(1),
    map((ok) => ok ? true : router.createUrlTree(['/login']))
  );
};
```
Add `authResolved: boolean` to the auth state (set true by both `setAuthState` and `loginFailure` in the bootstrap path). In `routes/app.routes.ts` for `admin/books`: delete `canLoad`, use `canMatch: [adminGuard]` and `canActivate: [authGuard]`. The auth state is rewritten in F5. Until then these selectors read from the existing store.

### F1.2 Token handling
- **Expiry check:** decode `exp` from the JWT and treat an expired token as logged out. Do this in `AuthEffects.handleLoginSuccess$` (where the payload is already decoded with `atob`; use a URL-safe base64 decode, `atob` alone breaks on `-`/`_`).
- **Role claim:** the backend B0.7 moves the role out of `sub` into the `role` claim (and `sub` becomes the user id). Update the mapping in `handleLoginSuccess$` (`userTypeName: payload.role ?? payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"]`). Confirm the actual claim name by decoding a token from the new backend.
- **Storage:** decision recorded in the plan: HttpOnly cookie. This needs backend work (set the cookie on login, `SameSite=Strict`, antiforgery for state-changing calls). Until the backend ships it, keep `localStorage.authToken`, and make everything go through **one** `TokenStorage` service so switching is a one-file change (today it is read in the interceptor, `auth.guard`, `auth.effects`, and cleared with `localStorage.clear()`). When the cookie is live: delete the Bearer interceptor, use `withCredentials`, and add the antiforgery header interceptor.

### F1.3 Error interceptor
Rewrite `interceptors/error-interceptor.service.ts`:

```ts
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(Store); const snack = inject(SnackbarService);
  return next(req).pipe(catchError((err: HttpErrorResponse) => {
    if (err.status === 401 && !req.url.includes('/api/login')) store.dispatch(sessionExpired());   // no location.reload()
    else if (err.status === 403) snack.error('You do not have permission to do that.');
    else if (err.status >= 500) snack.error('Something went wrong. Please try again.');
    return throwError(() => err);           // keep the HttpErrorResponse (status, ProblemDetails body)
  }));
};
```
- Remove the redirect to `not-found` on every 404 (the wildcard route already handles bad URLs).
- `login.component.ts` and `auth.effects.ts`: check `err.status === 401` instead of `error.includes("Unauthorized")`.
- Rename the exported functions to camelCase (`errorInterceptor`, `authTokenInterceptor`) and update `main.ts`.

### F1.4 Smaller fixes
- `returnUrl` on login: accept only app-relative paths:
  ```ts
  const safe = (u: string | null) => u && u.startsWith('/') && !u.startsWith('//') ? u : '/';
  ```
- External links in `nav-bar.component.html`: add `rel="noopener noreferrer"`.
- **Guest cart:** replace `setTempUserId()` (random number in `localStorage`) with the backend guest-cart cookie (B0.4 step 4). On login, the backend merges the guest cart into the user's cart server-side (B3), so the frontend never calls `SetShoppingCart`.
- **Logout:** clear the order slice too (the `order` reducer has no `logout` case).

### F1.5 Move Gemini behind the backend
In `components/book-summary/book-summary.component.ts` delete the `GoogleGenAI` import, `API_KEY`, `config` and the safety settings, and call the backend endpoint from B3 step 10:

```ts
summary = signal(''); loading = signal(false); error = signal<string | null>(null);
bookId = input.required<number>();
fetchSummary() {
  this.loading.set(true); this.error.set(null);
  this.http.post<{ summary: string }>(`/api/book/${this.bookId()}/summary`, {}).pipe(
    finalize(() => this.loading.set(false))
  ).subscribe({ next: r => this.summary.set(r.summary), error: () => this.error.set('Could not generate a summary.') });
}
```
Then `npm uninstall @google/genai`. This also removes the `ChangeDetectorRef.detectChanges()` hack.

### F1.6 Checkout payload
After backend B0.5, `checkout.service.ts` posts nothing but the shipping details (no `cartTotal`, no item prices) to `POST /api/checkout`. In `checkout.effects.ts` do not call "clear cart" separately: reload the cart (it is now empty server-side).

**Verify:**
- Log in/out; hard-refresh on `/admin/books` as admin (stays), as a normal user (redirected), and logged out (redirected to login with `returnUrl`).
- Delete `authToken` in DevTools → the next API call leads to login, with **no** full page reload.
- A tampered `returnUrl=//evil.com` goes to `/`.
- `grep -r "GoogleGenAI\|API_KEY" src` returns nothing.

---

## Phase F2: Test infrastructure (before the upgrade, so it protects the upgrade)

```bash
git checkout -b modernize/f2-tests
```

### F2.1 Choose the runner
The current `karma.conf.js` and `src/test.ts` cannot work with the esbuild builder (they reference `@angular-devkit/build-angular` and webpack's `require.context`). Two options:

- **Vitest (recommended).** Supported by Angular 22's builder (`vitest ^4.0.8 || ^5`). Do this **after F3.1** (Angular 21+), since the `@angular/build:unit-test` builder is the supported path. If you want tests *before* upgrading, use the Karma fix below as a bridge.
- **Karma bridge (works on Angular 20 today):**
  1. `karma.conf.js`: `frameworks: ['jasmine']`, plugins `karma-jasmine`, `karma-chrome-launcher`, `karma-jasmine-html-reporter`, `karma-coverage`, `reporters: ['progress', 'kjhtml']`, `browsers: ['ChromeHeadless']`.
  2. Delete `src/test.ts` and `tsconfig.spec.json`'s `files` entry for it, and remove `main` from the `test` target in `angular.json` (the esbuild test builder discovers `**/*.spec.ts` itself).
  3. `npm uninstall @angular/platform-browser-dynamic karma-coverage-istanbul-reporter jasmine-spec-reporter`.

### F2.2 Replace the boilerplate specs
```bash
git rm $(git ls-files 'src/**/*.spec.ts')      # 36 generated "should create" specs
```
Write real tests, starting where logic lives:

| Area | What to assert | Technique |
|---|---|---|
| Reducers (`cart`, `wishlist`, `book`, `auth`) | state transitions per action | plain function calls, no TestBed |
| Selectors | derived values (min/max price, cart totals, `selectCurrentUserId`) | `selector.projector(...)` |
| Effects | request → success/failure action | `provideMockActions`, `provideHttpClientTesting` |
| Guards | redirect/allow, `UrlTree` | `TestBed.runInInjectionContext` + `provideMockStore` |
| Interceptors | Bearer header added; 401 dispatches `sessionExpired` (no reload) | `HttpTestingController` |
| `CartService`, `BookService` | URL and verb | `provideHttpClientTesting` |
| 3-4 components (`book-card`, `shoppingcart`, `login`, `checkout`) | rendering, form validation, dispatches | `provideMockStore`, `provideRouter([])`, `NoopAnimationsModule` replacement |

Example effect test:
```ts
it('loads cart for the current user', () => {
  TestBed.configureTestingModule({ providers: [CartEffects, provideMockActions(() => of(loadCart())),
    provideMockStore({ selectors: [{ selector: selectCurrentUserId, value: 7 }] }),
    provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  let out: Action | undefined;
  TestBed.inject(CartEffects).loadCart$.subscribe(a => (out = a));
  http.expectOne('/api/shoppingcart/7').flush([]);
  expect(out).toEqual(loadCartSuccess({ shoppingCart: [] }));
});
```

### F2.3 CI
`.github/workflows/frontend.yml`:
```yaml
name: frontend
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: BookCart/ClientApp } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm, cache-dependency-path: BookCart/ClientApp/package-lock.json }
      - run: npm ci
      - run: npx ng test --watch=false --browsers=ChromeHeadless     # with Vitest: npx ng test --no-watch
      - run: npm run build
```

**Verify:** `npm test` passes headless, and **mutation check**: break a reducer on purpose and confirm a test fails.

---

## Phase F3: Upgrade Angular 20 → 21 → 22 (one major at a time, one commit each)

```bash
git checkout -b modernize/f3-upgrade
git status                              # must be clean: ng update requires it
```

### F3.1 → Angular 21
```bash
npx ng update @angular/core@21 @angular/cli@21
npx ng update @angular/material@21 @angular/cdk@21
npx ng update @ngrx/store@21 @ngrx/effects@21 @ngrx/entity@21 @ngrx/router-store@21 @ngrx/store-devtools@21 @ngrx/operators@21
npm install
npm run build && npm test
git add -A && git commit -m "Angular 21"
```
(Verify the exact NgRx v21 and v22 package versions and flags with `npm view @ngrx/store versions`, and run `npx ng update` with no arguments to see what it recommends.)
Read the migration notes `ng update` prints, and the update guide at https://angular.dev/update-guide (select 20 → 21).

### F3.2 → Angular 22
Needs **Node ≥ 24.15 (you have 24.21)** and **TypeScript 6.0**:
```bash
npx ng update @angular/core@22 @angular/cli@22
npx ng update @angular/material@22 @angular/cdk@22
npx ng update @ngrx/store@22 @ngrx/effects@22 @ngrx/entity@22 @ngrx/router-store@22 @ngrx/store-devtools@22 @ngrx/operators@22
npm install -D typescript@~6.0.3        # ng update normally bumps this. Confirm package.json
npm run build && npm test
git add -A && git commit -m "Angular 22"
```
TypeScript 6 may surface new errors. Fix these individually: `strict` leftovers, deprecated `moduleResolution`/`baseUrl` options, `lib` older than target. `tsconfig.json`: set `lib: ["ES2022","dom"]` (it is `es2020` today), and replace `baseUrl` with `paths` if TS 6 warns about it. Alternatively, convert the `src/app/...` imports to relative imports with a codemod:
```bash
grep -rln 'from "src/app/' src | xargs sed -i 's#from "src/app/#from "@app/#'      # then add "paths": {"@app/*": ["./src/app/*"]}
```

### F3.3 Post-upgrade deprecation cleanup (do these now, while the diff is small)
- `provideAnimations()` / `@angular/animations`: only `my-orders` uses it (the `detailExpand` trigger). Replace it with CSS (`animate.enter`/`animate.leave`, or a plain CSS `grid-template-rows` transition), then `npm uninstall @angular/animations` and delete `provideAnimations()` from `main.ts`. Check the update guide for the replacement API on your version.
- `canLoad` is gone (done in F1.1).
- Remove `experimentalDecorators` and `useDefineForClassFields: false` from `tsconfig.json` once the build passes without them (decorators are still used for `@Component`, which are standard decorators now).
- `@angular/platform-browser-dynamic` is no longer needed (and is removed in the F2 migration).
- `angular.json`: drop the unused `fileReplacements` (both environment files contain only `{production}`) and delete `environments/`. Remove the empty `src/assets` entry.

### F3.4 Switch tests to Vitest (if you took the Karma bridge in F2)
```bash
npm install -D vitest jsdom           # versions per the builder's peer range: vitest ^4.0.8 || ^5
```
`angular.json` → `projects.bookcart.architect.test`:
```json
"test": { "builder": "@angular/build:unit-test", "options": { "runner": "vitest", "buildTarget": "::development" } }
```
Then `npm uninstall karma karma-chrome-launcher karma-coverage karma-jasmine karma-jasmine-html-reporter jasmine-core @types/jasmine` and delete `karma.conf.js`. Replace jasmine globals in the specs: `jasmine.createSpyObj` → `vi.fn()`/`vi.spyOn`, `spyOn` → `vi.spyOn`, and `done` callbacks → async/await. Verify the builder name and option keys in the Angular 22 testing docs (https://angular.dev/guide/testing) before editing.

**Verify after each step:** `npm run build`, `npm test`, `npm start` (with the backend running) and the full smoke test (home, search, filter, details, guest cart, login, checkout, orders, wishlist, admin add/edit/delete).

---

## Phase F4: Component modernization (signals, zoneless, smart/dumb)

```bash
git checkout -b modernize/f4-signals
```

Work through one component at a time. Run the tests after each.

### F4.1 Signal inputs, outputs and queries

| Component | Change |
|---|---|
| `book-card`, `addtocart`, `addtowishlist`, `book-filter`, `book-summary` | `@Input() x` → `x = input.required<T>()` (setters become `computed`/`linkedSignal`) |
| `manage-books`, `my-orders` | `@ViewChild(MatPaginator)` → `paginator = viewChild.required(MatPaginator)`, and the same for `MatSort` |
| leaf components that call services | add `output<T>()` events instead (see F4.4) |

Optionally run the schematics for the mechanical part:
```bash
npx ng generate @angular/core:signal-input-migration
npx ng generate @angular/core:output-migration
npx ng generate @angular/core:signal-queries-migration
```
Review the result by hand. Templates then call `x()`. Specs set inputs with `fixture.componentRef.setInput('x', ...)`.

### F4.2 Replace `BehaviorSubject`s with signals
- `services/subscription.service.ts`: `priceFilterValue$ = new BehaviorSubject<number>(MAX)` → `priceFilterValue = signal(Number.MAX_SAFE_INTEGER)`. Update `price-filter` (writer) and `home` (reader, `computed`).
- `manage-books` and `my-orders`: `searchValue$` → `searchValue = signal('')`, and `filteredRows = computed(...)`. Drop `paginatorReady$` by using `viewChild`.
- `book-summary`: use `linkedSignal(() => '')` keyed on `bookId` for the summary text, so it resets when the book changes (this replaces the `@Input` setter).

### F4.3 `selectSignal` for read-only views
```ts
// before
cart$ = this.store.select(selectCartItems);        // template: @for (i of cart$ | async)
// after
cart = this.store.selectSignal(selectCartItems);   // template: @for (i of cart())
```
There are about 40 `store.select` call sites. Do them slice by slice so each commit stays small. This step is superseded by F5 for any slice that moves to SignalStore. **Do F4.3 only for slices that stay on classic NgRx** (the order you migrate in F5 decides this, so you can skip F4.3 for categories, similar-books, register, order, wishlist and cart).

### F4.4 Smart/dumb split
- **Dumb components** (inputs and outputs only, no `inject(Store)`/services): `book-card`, `book-filter`, `price-filter`, `search`, `addtocart`, `addtowishlist`, `similarbooks`, `book-summary`, `book-form`. Example for `addtocart`:
  ```ts
  bookId = input.required<number>(); inCart = input(false);
  add = output<number>();           // parent handles: this.cart.add(id)
  ```
- **Smart components** (route level, own the store/facade): `home`, `book-details`, `shoppingcart`, `checkout`, `my-orders`, `wishlist`, `manage-books`.
- Move the logic that currently sits in components' `map()` side effects (`checkout.component.ts` mutating `totalPrice` and calling `checkOutForm.disable()`, `login.component.ts` resetting the form inside `error$`, `search.component.ts` calling `setValue` inside an observable) into `effect()` or `computed()`, or into the parent.

### F4.5 Router inputs instead of router-store
In `main.ts`: `provideRouter(APP_ROUTES, withComponentInputBinding(), ...)`. Then:
```ts
// book-details.component.ts
id = input.required<string>();     // from route /books/details/:id
```
Replace `selectRouteParam("id")` and `selectQueryParams` uses (that's all `@ngrx/router-store` is used for). Delete `state/selectors/router.selectors.ts`, `provideRouterStore()` and `@ngrx/router-store` once nothing imports them.

### F4.6 Zoneless
After the above, remove the zone dependency:
```ts
// main.ts
providers: [provideZonelessChangeDetection(), ...]
```
Remove `"polyfills": ["src/polyfills.ts"]` from the `build` **and** `test` targets in `angular.json`, delete `src/polyfills.ts`, and `npm uninstall zone.js`.
Likely breakages: components that rely on a field mutation inside a callback without a signal (use `signal`, or `ChangeDetectorRef.markForCheck()` as a stop-gap), and `setTimeout`-based code. Make `app.component.ts` and `addtowishlist` OnPush (the only two that are not).

**Verify:** `npm test`, the full smoke test, and `ng serve` with the console open. There must be no `ExpressionChangedAfterItHasBeenChecked`, and every screen updates after interactions. Check the bundle: `zone.js` is gone from `dist/`.

---

## Phase F5: State management migration (NgRx classic → SignalStore)

```bash
git checkout -b modernize/f5-signalstore
npm install @ngrx/signals@^22
```

**One slice per commit**, in this order (simplest first): categories → similar-books → register → order → wishlist → cart → books → auth. Keep classic NgRx working side by side until the last slice moves.

### F5.1 Shared building block, `shared/with-call-state.ts`
```ts
export type CallState = 'init' | 'loading' | 'loaded' | { error: string };
export function withCallState() {
  return signalStoreFeature(
    withState<{ callState: CallState }>({ callState: 'init' }),
    withComputed(({ callState }) => ({
      loading: computed(() => callState() === 'loading'),
      error: computed(() => { const c = callState(); return typeof c === 'object' ? c.error : null; }),
    })));
}
export const setLoading = () => ({ callState: 'loading' as const });
export const setLoaded = () => ({ callState: 'loaded' as const });
export const setError = (e: string) => ({ callState: { error: e } });
```
This replaces `shared/call-state.ts` (`LoadingState` enum + `ErrorState`).

### F5.2 Template, using the cart as the example
`state/cart/cart.store.ts` replaces `actions/cart.actions.ts`, `reducers/cart.reducers.ts`, `selectors/cart.selectors.ts` and `effects/cart.effects.ts` (about 4 files → 1):

```ts
export const CartStore = signalStore(
  { providedIn: 'root' },
  withState<{ items: ShoppingCart[] }>({ items: [] }),
  withCallState(),
  withComputed(({ items }) => ({
    count: computed(() => items().reduce((n, i) => n + i.quantity, 0)),
    total: computed(() => items().reduce((s, i) => s + i.book.price * i.quantity, 0)),
  })),
  withMethods((store, api = inject(CartService), snack = inject(SnackbarService)) => ({
    load: rxMethod<void>(pipe(
      tap(() => patchState(store, setLoading())),
      switchMap(() => api.getCart().pipe(                 // userId no longer in the URL (backend B3)
        tapResponse({
          next: items => patchState(store, { items }, setLoaded()),
          error: (e: HttpErrorResponse) => patchState(store, setError(e.message)),
        }))))),
    add: rxMethod<number>(pipe(
      switchMap(bookId => api.addBook(bookId).pipe(
        tapResponse({
          next: items => { patchState(store, { items }); snack.show('Added to cart'); },
          error: (e: HttpErrorResponse) => snack.error(e.message),
        }))))),
    clear() { patchState(store, { items: [] }); },
  })),
);
```
Components: `cart = inject(CartStore)`, template `cart.items()`, `cart.count()`, `(click)="cart.add(id)"`. Remove `provideState(CART_FEATURE_KEY, …)`, `CartEffects` from `main.ts`, and delete the four old files for that slice.

Reload on auth change (replaces `ofType(loadCart, setAuthState)` in the old effect): in the store add `withHooks`, or in the `AuthStore` expose `userId` and in the cart store `rxMethod` over `toObservable(authStore.userId)`.

### F5.3 Per-slice notes
- **categories / similar-books / register / order:** straight server-mirror (`items + callState`). `similar-books` takes the book id as an `rxMethod<number>` input, which removes the never-completing `store.select` nested in `exhaustMap` (the analysis found this keeps refetching).
- **wishlist:** same as cart. Delete the toggle effect, with an optimistic update plus rollback on error if you want snappier UI.
- **books:** `withEntities<Book>()` from `@ngrx/signals/entities` replaces the entity adapter. Add `selectedId`, `filters` (`category`, `search`, `maxPrice`) and a `filtered` `computed`. This also **removes the filtering done inside `home.component.ts`'s `vm$`** and the spreads into `Math.min(...)` (compute min/max in one `reduce`). Fetch once and cache (`if (store.loaded()) return;`) instead of reloading on every visit to home, details and manage-books.
- **checkout:** no store. A `CheckoutService.placeOrder()` called from the smart component, followed by `cart.clear()` and navigation.
- **auth (last, riskiest):** `AuthStore` with `token`, `user`, `resolved`, and computed `isAuthenticated`, `isAdmin`, `userId`.
  - Initialise from storage synchronously with `withHooks({ onInit })`, so there is **no `loginSuccess()` dispatched from `AppComponent`'s constructor** and no flash of `isAuthenticated: true`.
  - Delete the impure `selectCurrentUserId` (localStorage inside a selector). Guests are represented by the backend guest cookie, so no frontend guest id is needed.
  - `login(creds)` / `logout()` as `rxMethod`s. Logout resets every store (`patchState(store, initial)`; expose a `resetAll()` that the stores subscribe to, or inject the stores in `AuthStore.logout`).
  - The guards from F1 switch from `store.select(...)` to `toObservable(auth.resolved)`.

### F5.4 Cleanup (after the last slice)
```bash
npm uninstall @ngrx/store @ngrx/effects @ngrx/entity @ngrx/router-store @ngrx/store-devtools @ngrx/operators
```
(Keep `@ngrx/operators` if you use `tapResponse`: it is re-exported by `@ngrx/operators`, so keep that package.) Delete `src/app/state/` (actions/effects/reducers/selectors), `shared/call-state.ts`, `models/customtheme.ts`, and all `provideStore/provideEffects/provideState/provideStoreDevtools` calls (the SignalStore devtools are optional: `@angular-architects/ngrx-toolkit` has `withDevtools`).

### F5.5 Tests (per store, no `MockStore`)
```ts
it('adds an item', () => {
  TestBed.configureTestingModule({ providers: [CartStore, { provide: CartService, useValue: { addBook: () => of([item]) } }] });
  const store = TestBed.inject(CartStore);
  store.add(1);
  expect(store.count()).toBe(1);
});
```

**Verify per slice:** unit tests, then the matching manual path. Check the **Network tab**: one request per action (add to cart makes one POST and no extra GET of all books). Keep `git bisect`-friendly commits.

---

## Phase F6: Styling, UI and performance

```bash
git checkout -b modernize/f6-ui
```

### F6.1 Material 3 theme
Replace the prebuilt `indigo-pink.css` entry in `angular.json` (both `build` and `test` targets, both the `materialStyle` bundle) with a theme file:

```scss
// src/styles/theme.scss
@use '@angular/material' as mat;
html {
  color-scheme: light dark;
  @include mat.theme((
    color: (theme-type: color-scheme, primary: mat.$azure-palette, tertiary: mat.$magenta-palette),
    typography: Roboto,
    density: 0
  ));
}
```
(Check the `mat.theme` signature in the Angular Material 22 docs; the palette names are `mat.$azure-palette`, `$violet-palette`, etc.) This gives light/dark from `prefers-color-scheme` with no extra code. Replace hard-coded colours (`#ff4081`, `#b30000`, `#fafafa`) with `var(--mat-sys-primary)`, `var(--mat-sys-error)`, `var(--mat-sys-surface)`. Audit the legacy Material usage (`mat-raised-button` → `matButton="filled"`/`"outlined"` per the v22 button API, `mat-elevation-z*` classes, `color="primary"` inputs → theme tokens).

### F6.2 Replace Bootstrap with Tailwind v4
```bash
npm uninstall bootstrap
npm install -D tailwindcss @tailwindcss/postcss postcss
```
`.postcssrc.json` in `ClientApp/`:
```json
{ "plugins": { "@tailwindcss/postcss": {} } }
```
`src/styles.css` (or at the top of `styles.scss`: Tailwind's `@import "tailwindcss"` needs plain CSS, so move the file to `.css`, or import a separate `tailwind.css` and add it to the `styles` array):
```css
@import "tailwindcss";
@layer base { /* Tailwind preflight resets some Material element styles: test buttons, inputs, and tables */ }
```
Then convert templates. The classes in use map directly: `d-flex` → `flex`, `justify-content-between` → `justify-between`, `row`/`col-md-3` → `grid grid-cols-1 md:grid-cols-4 gap-4`, `p-3` → `p-3`, `mt-4` → `mt-4`, `ms-2` → `ms-2`, `my-4` → `my-4`, `w-50` → `w-full max-w-xl`. Delete the hand-rolled `.w-100`/`.w-50` in `styles.scss`, and the two Bootstrap `@import` lines (deprecated Sass `@import` goes with them).
If you would rather avoid Tailwind, convert the same classes to component-scoped CSS Grid/Flexbox. The rest of F6 is unchanged.

### F6.3 Responsive navigation and layout
- `nav-bar`: on `< md`, collapse links into a `mat-menu`/`mat-sidenav`, using `BreakpointObserver` → `isHandset = toSignal(...)`. Replace the fixed `.container { padding-top: 60px }` with a sticky toolbar.
- `login`, `checkout`, `user-registration`: remove the fixed `w-50` card. Use `w-full max-w-xl mx-auto`.
- Check at 360 px and 768 px.

### F6.4 Images
```ts
imports: [NgOptimizedImage]
```
```html
<img [ngSrc]="'/Upload/' + book().coverFileName" width="200" height="300"
     [alt]="book().title + ' cover'" [priority]="index < 4">
```
(`priority` only for the first row.) Add `loading="lazy"` behaviour comes with `ngSrc` by default. Resized variants need backend support (an image-resize endpoint or pre-generated thumbnails), so treat that as optional.

### F6.5 Loading and bundle
- Preloading: replace `PreloadAllModules` with a selective strategy so the admin chunk is not downloaded by anonymous visitors:
  ```ts
  { path: 'admin/books', data: { preload: false }, ... }
  @Injectable({ providedIn: 'root' }) class SelectivePreload implements PreloadingStrategy {
    preload(r: Route, load: () => Observable<any>) { return r.data?.['preload'] === false ? EMPTY : load(); }
  }
  ```
- `@defer (on viewport) { <app-similarbooks .../> }` for `similarbooks` on the details page (and for `book-summary`).
- Pagination or virtual scroll for the home grid (after backend B4.5): `cdk-virtual-scroll-viewport`, or server-side paging with `mat-paginator`.
- Tighten `angular.json` budgets (initial `warning: 500kb`, `error: 1mb`) after measuring.
- Add `provideHttpClient(withFetch(), withInterceptors([...]))`.

### F6.6 Accessibility
Real `alt` text, a label for every icon-only button (`aria-label`), keyboard focus order in the nav, and colour contrast under the new theme. Run Lighthouse and axe on home, details and checkout.

**Verify:** Lighthouse (performance and accessibility) before/after (record the F0 baseline), screenshots at 360/768/1280 px in light and dark, and `npm run build` shows a smaller initial bundle than the baseline (Bootstrap + animations + zone.js + genai are gone).

---

## Phase F7 (optional): SSR and hydration

Only if SEO or first-paint on mobile matters (book detail pages are the candidate).
```bash
npx ng add @angular/ssr
```
It adds `server.ts`, `provideClientHydration(withEventReplay())` and an SSR build. Considerations specific to this app:
- Hosting a Node SSR server next to ASP.NET changes the SpaProxy/deploy story. Alternatives: prerender only the public routes (`outputMode: 'static'` for home and details) and keep serving static files from ASP.NET.
- Remove direct `localStorage`/`document`/`window` use first (the `TokenStorage` service from F1 isolates this, so guard it with `isPlatformBrowser`).
- Authenticated pages (cart, checkout, orders, admin) stay client-rendered (`renderMode: RenderMode.Client` per route).

---

## Final checklist

```bash
npm ci && npm run build && npm test
npx ng build --stats-json && npx source-map-explorer dist/**/*.js     # compare bundle with the F0 baseline
grep -rn "ngIf\|ngFor\|@Input()\|@ViewChild\|BehaviorSubject\|localStorage" src/app    # should be nearly empty (TokenStorage only)
```

## Rollback notes
- Each phase is a separate branch. Revert the PR.
- F3: `git revert` the version commits one at a time (22 first, then 21). `package-lock.json` is committed, so a revert restores exact versions.
- F5 slices are independent commits and can stay half-migrated, because classic NgRx and SignalStore coexist.

## Order summary
`F0 hygiene → F1 security (with backend B0) → F2 tests → F3 upgrade (21, then 22) → F4 signals/zoneless → F5 SignalStore → F6 M3 + Tailwind + perf → F7 SSR (optional)`
