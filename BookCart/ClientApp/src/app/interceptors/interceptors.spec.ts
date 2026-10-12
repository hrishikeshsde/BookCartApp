import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { SnackbarService } from "../services/snackbar.service";
import { TokenStorage } from "../services/token-storage.service";
import { AuthStore } from "../state/auth/auth.store";
import { anHourAgo, aToken, inOneHour } from "../testing/fixtures";
import { SnackbarStub } from "../testing/helpers";
import { errorInterceptor } from "./error-interceptor.service";
import { authTokenInterceptor } from "./http-interceptor.service";

describe("authTokenInterceptor", () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let tokens: TokenStorage;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr(), withInterceptors([authTokenInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    tokens = TestBed.inject(TokenStorage);
  });
  afterEach(() => {
    http.verify();
    localStorage.removeItem("authToken");
  });

  it("sends the stored token as a Bearer header", () => {
    const token = aToken({ userId: "7", exp: inOneHour() });
    tokens.set(token);
    client.get("/api/wishlist").subscribe();
    expect(http.expectOne("/api/wishlist").request.headers.get("Authorization")).toBe("Bearer " + token);
  });

  it("sends no header when there is no token", () => {
    client.get("/api/book").subscribe();
    expect(http.expectOne("/api/book").request.headers.has("Authorization")).toBe(false);
  });

  it("never sends an expired token (and removes it)", () => {
    tokens.set(aToken({ userId: "7", exp: anHourAgo() }));
    client.get("/api/book").subscribe();
    expect(http.expectOne("/api/book").request.headers.has("Authorization")).toBe(false);
    expect(localStorage.getItem("authToken")).toBeNull();
  });
});

describe("errorInterceptor", () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let snackbar: SnackbarStub;
  const expireSession = vi.fn();

  beforeEach(() => {
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr(), withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { expireSession } },
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    expireSession.mockClear();
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });
  afterEach(() => http.verify());

  function failWith(url: string, status: number) {
    let caught: unknown;
    client.get(url).subscribe({ error: (e) => (caught = e) });
    http.expectOne(url).flush({ title: "problem" }, { status, statusText: "x" });
    return caught;
  }

  it("a 401 ends the session (the store clears the token and goes to login; the page is not reloaded)", () => {
    failWith("/api/wishlist", 401);
    expect(expireSession).toHaveBeenCalledTimes(1);
  });

  it("a 401 from the login call is a wrong password, not an expired session", () => {
    failWith("/api/login", 401);
    expect(expireSession).not.toHaveBeenCalled();
  });

  it("a 403 and a server error each get one message", () => {
    failWith("/api/book", 403);
    failWith("/api/book", 500);
    expect(snackbar.messages).toEqual([
      "You do not have permission to do that.",
      "Something went wrong. Please try again.",
    ]);
  });

  it("a 404 is left to the caller (no redirect, no message)", () => {
    failWith("/api/book/9", 404);
    expect(expireSession).not.toHaveBeenCalled();
    expect(snackbar.messages).toEqual([]);
  });

  it("passes the original HttpErrorResponse on, status and body intact", () => {
    const caught = failWith("/api/book", 409) as HttpErrorResponse;
    expect(caught instanceof HttpErrorResponse).toBe(true);
    expect(caught.status).toBe(409);
    expect(caught.error).toEqual({ title: "problem" });
  });
});
