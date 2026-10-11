import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { Subject } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { TokenStorage } from "src/app/services/token-storage.service";
import { INVALID_CREDENTIALS } from "src/app/shared/http-error";
import { anHourAgo, aToken, inOneHour } from "src/app/testing/fixtures";
import { collect, SnackbarStub } from "src/app/testing/helpers";
import {
  login,
  loginFailure,
  loginSuccess,
  logout,
  restoreSession,
  sessionExpired,
  sessionResolved,
  setAuthState,
} from "../actions/auth.actions";
import { selectQueryParams } from "../selectors/router.selectors";
import { AuthEffects } from "./auth.effects";

const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";
const credentials = { username: "reader", password: "Abcdefg1" };

describe("AuthEffects", () => {
  let actions$: Subject<Action>;
  let effects: AuthEffects;
  let http: HttpTestingController;
  let store: MockStore;
  let tokens: TokenStorage;
  let navigateByUrl: jasmine.Spy;
  let navigate: jasmine.Spy;
  let snackbar: SnackbarStub;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    actions$ = new Subject<Action>();
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        AuthEffects,
        provideMockActions(() => actions$),
        provideMockStore({ selectors: [{ selector: selectQueryParams, value: {} }] }),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    effects = TestBed.inject(AuthEffects);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MockStore);
    tokens = TestBed.inject(TokenStorage);
    const router = TestBed.inject(Router);
    navigateByUrl = spyOn(router, "navigateByUrl").and.resolveTo(true);
    navigate = spyOn(router, "navigate").and.resolveTo(true);
  });
  afterEach(() => {
    http.verify();
    store.resetSelectors(); // an override is global: it would leak into every later spec
    localStorage.removeItem("authToken");
  });

  describe("login", () => {
    it("keeps the token and goes where the visitor was headed", () => {
      store.overrideSelector(selectQueryParams, { returnUrl: "/wishlist" });
      const out = collect(effects.login$);

      actions$.next(login({ loginCredentials: credentials }));
      const token = aToken({ userId: "7", name: "reader", exp: inOneHour() });
      http.expectOne("/api/login").flush({ token });

      expect(out).toEqual([loginSuccess()]);
      expect(tokens.get()).toBe(token);
      expect(navigateByUrl).toHaveBeenCalledWith("/wishlist");
    });

    it("never follows a return URL that leaves the app", () => {
      store.overrideSelector(selectQueryParams, { returnUrl: "//evil.com" });
      collect(effects.login$);

      actions$.next(login({ loginCredentials: credentials }));
      http.expectOne("/api/login").flush({ token: aToken({ userId: "7" }) });

      expect(navigateByUrl).toHaveBeenCalledWith("/");
    });

    it("a wrong password is reported as invalid credentials and stores nothing", () => {
      const out = collect(effects.login$);

      actions$.next(login({ loginCredentials: credentials }));
      http.expectOne("/api/login").flush("", { status: 401, statusText: "Unauthorized" });

      expect(out).toEqual([loginFailure({ errorMessage: INVALID_CREDENTIALS })]);
      expect(tokens.get()).toBeNull();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it("any other failure is reported with the server's own words", () => {
      const out = collect(effects.login$);

      actions$.next(login({ loginCredentials: credentials }));
      http
        .expectOne("/api/login")
        .flush({ title: "Too Many Requests" }, { status: 429, statusText: "Too Many Requests" });

      expect(out).toEqual([loginFailure({ errorMessage: "Too Many Requests" })]);
    });
  });

  describe("restoreSession", () => {
    it("signs in the user a stored token describes", () => {
      tokens.set(aToken({ userId: "7", name: "reader", [ROLE_CLAIM]: "Admin", exp: inOneHour() }));
      const out = collect(effects.restoreSession$);

      actions$.next(restoreSession());

      expect(out.length).toBe(1);
      const action = out[0] as ReturnType<typeof setAuthState>;
      expect(action.type).toBe(setAuthState.type);
      expect(action.user.userId).toBe(7);
      expect(action.user.userTypeName).toBe("Admin");
    });

    it("resolves as a guest when there is no token", () => {
      const out = collect(effects.restoreSession$);
      actions$.next(restoreSession());
      expect(out).toEqual([sessionResolved()]);
    });

    it("resolves as a guest when the stored token has expired, and removes it", () => {
      tokens.set(aToken({ userId: "7", exp: anHourAgo() }));
      const out = collect(effects.restoreSession$);
      actions$.next(restoreSession());
      expect(out).toEqual([sessionResolved()]);
      expect(localStorage.getItem("authToken")).toBeNull();
    });
  });

  describe("after a login", () => {
    it("sets the user from the new token", () => {
      tokens.set(aToken({ userId: "7", name: "reader", role: "User", exp: inOneHour() }));
      const out = collect(effects.handleLoginSuccess$);
      actions$.next(loginSuccess());
      expect(out[0].type).toBe(setAuthState.type);
    });

    it("fails when there is no usable token", () => {
      const out = collect(effects.handleLoginSuccess$);
      actions$.next(loginSuccess());
      expect(out).toEqual([loginFailure({ errorMessage: "Invalid token" })]);
    });
  });

  describe("leaving", () => {
    it("logout removes the token and goes to the login page", () => {
      tokens.set(aToken({ userId: "7", exp: inOneHour() }));
      effects.logout$.subscribe();
      actions$.next(logout());
      expect(localStorage.getItem("authToken")).toBeNull();
      expect(navigate).toHaveBeenCalledWith(["/login"]);
    });

    it("an expired session removes the token, says so, and goes to login with the way back", () => {
      tokens.set(aToken({ userId: "7", exp: inOneHour() }));
      effects.sessionExpired$.subscribe();

      actions$.next(sessionExpired({ hadSession: true }));

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(snackbar.messages).toEqual(["Your session has expired. Please log in again."]);
      expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { returnUrl: "/" } });
    });

    it("a guest bounced by a login-only call is sent to login without a scary message", () => {
      effects.sessionExpired$.subscribe();
      actions$.next(sessionExpired({ hadSession: false }));
      expect(snackbar.messages).toEqual([]);
      expect(navigate).toHaveBeenCalled();
    });
  });
});
