import { provideHttpClient, withXhr } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRouteSnapshot, PartialMatchRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlSegment, UrlTree } from "@angular/router";
import { TokenStorage } from "../services/token-storage.service";
import { AuthStore } from "../state/auth/auth.store";
import { anHourAgo, aToken, inOneHour } from "../testing/fixtures";
import { adminGuard } from "./admin-auth.guard";
import { authGuard } from "./auth.guard";

type Outcome = boolean | UrlTree;

describe("route guards", () => {
  let router: Router;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);
  });
  afterEach(() => localStorage.removeItem("authToken"));

  /** Leaves a login token behind, as an earlier visit would have; AuthStore picks it up when it is first used. */
  const visitedBeforeAs = (role: "Admin" | "User", exp = inOneHour()) =>
    TestBed.inject(TokenStorage).set(aToken({ userId: "7", name: "reader", role, exp }));

  const runAuthGuard = (url: string) => TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as Outcome;

  const runAdminGuard = () =>
    TestBed.runInInjectionContext(() => adminGuard({}, [new UrlSegment("admin", {}), new UrlSegment("books", {})], {} as PartialMatchRouteSnapshot)) as Outcome;

  const asText = (outcome: Outcome) => (outcome instanceof UrlTree ? router.serializeUrl(outcome) : outcome);

  describe("authGuard", () => {
    it("lets a visitor through who signed in on an earlier visit (the stored token), at once", () => {
      visitedBeforeAs("User");
      expect(runAuthGuard("/wishlist")).toBe(true);
    });

    it("sends a guest to login and remembers where they were going", () => {
      expect(asText(runAuthGuard("/checkout?x=1"))).toBe("/login?returnUrl=%2Fcheckout%3Fx%3D1");
    });

    it("sends a visitor whose stored token has expired to login", () => {
      visitedBeforeAs("User", anHourAgo());
      expect(asText(runAuthGuard("/wishlist"))).toBe("/login?returnUrl=%2Fwishlist");
    });

    it("sends someone who has logged out to login", () => {
      visitedBeforeAs("User");
      expect(runAuthGuard("/wishlist")).toBe(true);

      TestBed.inject(AuthStore).logout();

      expect(asText(runAuthGuard("/wishlist"))).toBe("/login?returnUrl=%2Fwishlist");
    });
  });

  describe("adminGuard", () => {
    it("lets an admin through", () => {
      visitedBeforeAs("Admin");
      expect(runAdminGuard()).toBe(true);
    });

    it("sends a signed-in non-admin home", () => {
      visitedBeforeAs("User");
      expect(asText(runAdminGuard())).toBe("/");
    });

    it("sends a guest to login and remembers the admin address", () => {
      expect(asText(runAdminGuard())).toBe("/login?returnUrl=%2Fadmin%2Fbooks");
    });
  });
});
