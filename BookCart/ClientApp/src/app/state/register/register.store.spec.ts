import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { SnackbarService } from "src/app/services/snackbar.service";
import { UserRegistration } from "src/app/models/userRegistration";
import { SnackbarStub } from "src/app/testing/helpers";
import { RegisterStore } from "./register.store";

const details: UserRegistration = {
  firstName: "Ada",
  lastName: "Writer",
  username: "adawriter",
  password: "Abcdefg1",
  gender: "Female",
};

describe("RegisterStore", () => {
  let store: InstanceType<typeof RegisterStore>;
  let http: HttpTestingController;
  let snackbar: SnackbarStub;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    store = TestBed.inject(RegisterStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it("sends what was typed, and on success says so and goes to the login page", () => {
    store.register(details);
    expect(store.loading()).toBe(true);

    const request = http.expectOne("/api/user/");
    expect(request.request.method).toBe("POST");
    expect(request.request.body).toEqual(details);
    request.flush(null);

    expect(store.loaded()).toBe(true);
    expect(snackbar.messages).toEqual(["Registration successful"]);
    expect(navigate).toHaveBeenCalledWith(["/login"]);
  });

  it("on failure keeps the visitor on the page and says to try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.register(details);
    http.expectOne("/api/user/").flush({ detail: "Username is taken" }, { status: 409, statusText: "Conflict" });

    expect(store.error()).toBe("Username is taken");
    expect(snackbar.messages).toEqual(["An error occurred. Please try again."]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
