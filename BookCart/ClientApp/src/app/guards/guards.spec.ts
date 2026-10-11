import { TestBed } from "@angular/core/testing";
import { ActivatedRouteSnapshot, PartialMatchRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlSegment, UrlTree, } from "@angular/router";
import { provideStore, Store } from "@ngrx/store";
import { Observable } from "rxjs";
import { logout, sessionResolved, setAuthState } from "../state/actions/auth.actions";
import { AUTH_FEATURE_KEY, authReducer } from "../state/reducers/auth.reducers";
import { aUser } from "../testing/fixtures";
import { adminGuard } from "./admin-auth.guard";
import { authGuard } from "./auth.guard";

type Outcome = boolean | UrlTree;

describe("route guards", () => {
  let store: Store;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideStore({ [AUTH_FEATURE_KEY]: authReducer }), provideRouter([])],
    });
    store = TestBed.inject(Store);
    router = TestBed.inject(Router);
  });

  const runAuthGuard = (url: string) => TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as Observable<Outcome>;

  const runAdminGuard = () => TestBed.runInInjectionContext(() => adminGuard({}, [new UrlSegment("admin", {}), new UrlSegment("books", {})], {} as PartialMatchRouteSnapshot)) as Observable<Outcome>;

  /** Subscribes and returns what the guard has decided so far (nothing yet means it is still waiting). */
  function decision(guard: Observable<Outcome>) {
    const result: {
      value?: Outcome;
    } = {};
    guard.subscribe((outcome) => (result.value = outcome));
    return result;
  }
  const asText = (outcome?: Outcome) => (outcome instanceof UrlTree ? router.serializeUrl(outcome) : outcome);

  describe("authGuard", () => {
    it("waits while the stored token is still being looked at", () => {
      const result = decision(runAuthGuard("/wishlist"));
      expect(result.value).toBeUndefined();
    });

    it("lets a signed-in visitor through, as soon as that is known", () => {
      const result = decision(runAuthGuard("/wishlist"));
      store.dispatch(setAuthState({ user: aUser() }));
      expect(result.value).toBe(true);
    });

    it("sends a guest to login and remembers where they were going", () => {
      const result = decision(runAuthGuard("/checkout?x=1"));
      store.dispatch(sessionResolved());
      expect(asText(result.value)).toBe("/login?returnUrl=%2Fcheckout%3Fx%3D1");
    });

    it("sends someone who has logged out to login", () => {
      store.dispatch(setAuthState({ user: aUser() }));
      store.dispatch(logout());
      expect(asText(decision(runAuthGuard("/wishlist")).value)).toBe("/login?returnUrl=%2Fwishlist");
    });
  });

  describe("adminGuard", () => {
    it("waits while the stored token is still being looked at", () => {
      expect(decision(runAdminGuard()).value).toBeUndefined();
    });

    it("lets an admin through", () => {
      store.dispatch(setAuthState({ user: aUser({ userTypeName: "Admin" }) }));
      expect(decision(runAdminGuard()).value).toBe(true);
    });

    it("sends a signed-in non-admin home", () => {
      store.dispatch(setAuthState({ user: aUser({ userTypeName: "User" }) }));
      expect(asText(decision(runAdminGuard()).value)).toBe("/");
    });

    it("sends a guest to login and remembers the admin address", () => {
      store.dispatch(sessionResolved());
      expect(asText(decision(runAdminGuard()).value)).toBe("/login?returnUrl=%2Fadmin%2Fbooks");
    });
  });
});
