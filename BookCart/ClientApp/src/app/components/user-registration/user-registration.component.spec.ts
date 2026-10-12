import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RegisterStore } from "src/app/state/register/register.store";
import { UserRegistrationComponent } from "./user-registration.component";

const valid = {
  firstName: "Ada",
  lastName: "Writer",
  userName: "adawriter",
  password: "Abcdefg1",
  confirmPassword: "Abcdefg1",
  gender: "Female",
};

describe("UserRegistrationComponent", () => {
  let fixture: ComponentFixture<UserRegistrationComponent>;
  let component: UserRegistrationComponent;
  let http: HttpTestingController;
  const register = vi.fn();

  beforeEach(() => {

    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [UserRegistrationComponent],
      providers: [provideRouter([]), { provide: RegisterStore, useValue: { register } }, provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    register.mockClear();
    fixture = TestBed.createComponent(UserRegistrationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  /** Fills the form and lets the user-name availability check (half a second, then one request) finish. */
  function fill(values: Partial<typeof valid>, nameIsFree = true) {
    component.registrationForm.setValue({ ...valid, ...values });
    vi.advanceTimersByTime(500);
    const name = values.userName ?? valid.userName;
    http.expectOne("/api/user/validateUserName/" + encodeURIComponent(name)).flush(nameIsFree);
  }

  it("a complete, valid form is registered with exactly what was typed", () => {
    fill({});
    expect(component.registrationForm.valid).toBe(true);
    component.registerUser();
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Ada", password: "Abcdefg1" }));
  });

  it("a taken user name blocks the form", () => {
    fill({}, false);
    expect(component.registrationForm.controls.userName.errors).toEqual({ userNameNotAvailable: true });
    component.registerUser();
    expect(register).not.toHaveBeenCalled();
  });

  it("a weak password blocks the form", () => {
    fill({ password: "abcdefgh", confirmPassword: "abcdefgh" });
    expect(component.registrationForm.controls.password.errors).toEqual({ passwordValidation: true });
    expect(component.registrationForm.valid).toBe(false);
  });

  it("a confirmation that differs blocks the form", () => {
    fill({ confirmPassword: "Different1" });
    expect(component.registrationForm.controls.confirmPassword.errors).toEqual({ passwordMismatch: true });
    expect(component.registrationForm.valid).toBe(false);
  });

  it("does not ask the server anything until a name is typed", () => {
    vi.advanceTimersByTime(1000);
    http.expectNone(() => true);
  });
});
