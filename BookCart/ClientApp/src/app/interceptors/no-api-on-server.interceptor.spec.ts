import { HttpClient, provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { noApiOnServerInterceptor } from "./no-api-on-server.interceptor";

describe("noApiOnServerInterceptor", () => {
  let http: HttpTestingController;
  let client: HttpClient;

  function setUp(platform: "server" | "browser") {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        provideHttpClient(withInterceptors([noApiOnServerInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  }

  afterEach(() => http.verify());

  it("while a page is drawn at build time, a call to the API ends with no answer and sends nothing", () => {
    setUp("server");
    let answers = 0;
    let completed = false;
    client.get("/api/book").subscribe({ next: () => answers++, complete: () => (completed = true) });

    http.expectNone("/api/book");
    expect(answers).toBe(0);
    expect(completed).toBe(true);   // it finishes, so the build is not left waiting for the page to settle
  });

  it("leaves other requests alone, also at build time", () => {
    setUp("server");
    client.get("/assets/data.json").subscribe();
    http.expectOne("/assets/data.json").flush({});
  });

  it("in the browser every call goes through", () => {
    setUp("browser");
    client.get("/api/book").subscribe();
    http.expectOne("/api/book").flush([]);
  });
});
