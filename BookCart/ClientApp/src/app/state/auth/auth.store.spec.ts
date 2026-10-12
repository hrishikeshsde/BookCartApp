import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { SnackbarService } from "src/app/services/snackbar.service";
import { TokenStorage } from "src/app/services/token-storage.service";
import { INVALID_CREDENTIALS } from "src/app/shared/http-error";
import { anHourAgo, aToken, inOneHour } from "src/app/testing/fixtures";
import { SnackbarStub } from "src/app/testing/helpers";
import { AuthStore } from "./auth.store";

const credentials = { username: "reader", password: "Abcdefg1" };
const tokenFor = (role: "Admin" | "User") => aToken({ userId: "7", name: "reader", role, exp: inOneHour() });

describe("AuthStore", () => {
  let http: HttpTestingController;
  let router: Router;
  let tokens: TokenStorage;
  let snackbar: SnackbarStub;
  let navigate: ReturnType<typeof vi.spyOn>;
  let navigateByUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    tokens = TestBed.inject(TokenStorage);
    navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
  });
  afterEach(() => {
    http.verify();
    localStorage.removeItem("authToken");
  });

  /** The store reads the stored token when it is created, so leave one behind first, as an earlier visit would. */
  const create = () => TestBed.inject(AuthStore);

  describe("at the start", () => {
    it("a visitor with no stored token is a guest", () => {
      const store = create();
      expect(store.user()).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
      expect(store.isAdmin()).toBe(false);
      expect(store.userId()).toBeNull();
    });

    it("a stored valid token is a signed-in session straight away (nothing to wait for)", () => {
      tokens.set(tokenFor("User"));
      const store = create();
      expect(store.isAuthenticated()).toBe(true);
      expect(store.userId()).toBe(7);
      expect(store.user()?.username).toBe("reader");
      expect(store.isAdmin()).toBe(false);
    });

    it("an Admin token makes an admin", () => {
      tokens.set(tokenFor("Admin"));
      expect(create().isAdmin()).toBe(true);
    });

    it("an expired token is a guest, and the token is removed", () => {
      tokens.set(aToken({ userId: "7", name: "reader", exp: anHourAgo() }));
      expect(create().isAuthenticated()).toBe(false);
      expect(localStorage.getItem("authToken")).toBeNull();
    });

    it("a malformed token is a guest", () => {
      localStorage.setItem("authToken", "not-a-token");
      expect(create().isAuthenticated()).toBe(false);
    });
  });

  describe("login", () => {
    it("sends the credentials, keeps the token, signs in and goes to the home page", () => {
      const store = create();
      store.login({ credentials });
      expect(store.loading()).toBe(true);

      const request = http.expectOne("/api/login");
      expect(request.request.method).toBe("POST");
      expect(request.request.body).toEqual(credentials);
      const token = tokenFor("User");
      request.flush({ token });

      expect(localStorage.getItem("authToken")).toBe(token);
      expect(store.isAuthenticated()).toBe(true);
      expect(store.userId()).toBe(7);
      expect(store.loaded()).toBe(true);
      expect(navigateByUrl).toHaveBeenCalledWith("/");
    });

    it("goes back to where the visitor was headed", () => {
      const store = create();
      store.login({ credentials, returnUrl: "/wishlist" });
      http.expectOne("/api/login").flush({ token: tokenFor("User") });
      expect(navigateByUrl).toHaveBeenCalledWith("/wishlist");
    });

    it("never follows a return URL that leaves the site", () => {
      const store = create();
      store.login({ credentials, returnUrl: "//evil.example" });
      http.expectOne("/api/login").flush({ token: tokenFor("User") });
      expect(navigateByUrl).toHaveBeenCalledWith("/");
    });

    it("a wrong user name or password is flagged as such, and nothing is stored", () => {
      const store = create();
      store.login({ credentials });
      http.expectOne("/api/login").flush(null, { status: 401, statusText: "Unauthorized" });

      expect(store.error()).toBe(INVALID_CREDENTIALS);
      expect(store.isAuthenticated()).toBe(false);
      expect(localStorage.getItem("authToken")).toBeNull();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it("any other failure gives its reason, not the wrong-password flag", () => {
      const store = create();
      store.login({ credentials });
      http.expectOne("/api/login").flush({ title: "Too Many Requests" }, { status: 429, statusText: "Too Many Requests" });
      expect(store.error()).toBe("Too Many Requests");
    });

    it("an answer whose token cannot be read does not sign anyone in", () => {
      const store = create();
      store.login({ credentials });
      http.expectOne("/api/login").flush({ token: "garbage" });
      expect(store.isAuthenticated()).toBe(false);
      expect(store.error()).toBe("Invalid token");
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it("resetLoginError forgets an old error", () => {
      const store = create();
      store.login({ credentials });
      http.expectOne("/api/login").flush(null, { status: 401, statusText: "Unauthorized" });
      store.resetLoginError();
      expect(store.error()).toBeNull();
    });
  });

  describe("logout", () => {
    it("forgets the token and the user and goes to the login page", () => {
      tokens.set(tokenFor("Admin"));
      const store = create();
      store.logout();

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
      expect(store.isAdmin()).toBe(false);
      expect(navigate).toHaveBeenCalledWith(["/login"]);
    });
  });

  describe("expireSession (the server said 401)", () => {
    it("ends a signed-in session, says so, and sends them to login to come back to where they were", () => {
      tokens.set(tokenFor("User"));
      const store = create();
      vi.spyOn(router, "url", "get").mockReturnValue("/wishlist");

      store.expireSession();

      expect(store.isAuthenticated()).toBe(false);
      expect(localStorage.getItem("authToken")).toBeNull();
      expect(snackbar.messages).toEqual(["Your session has expired. Please log in again."]);
      expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { returnUrl: "/wishlist" } });
    });

    it("for a guest it only sends them to login (there was no session to lose)", () => {
      const store = create();
      vi.spyOn(router, "url", "get").mockReturnValue("/wishlist");

      store.expireSession();

      expect(snackbar.messages).toEqual([]);
      expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { returnUrl: "/wishlist" } });
    });

    it("does not redirect when already on the login page", () => {
      const store = create();
      vi.spyOn(router, "url", "get").mockReturnValue("/login?returnUrl=%2Fwishlist");
      store.expireSession();
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
