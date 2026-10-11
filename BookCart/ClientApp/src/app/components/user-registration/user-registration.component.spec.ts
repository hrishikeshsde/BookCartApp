import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, fakeAsync, TestBed, tick } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { register } from "src/app/state/actions/auth.actions";
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
  let dispatch: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UserRegistrationComponent],
      providers: [provideRouter([]), provideMockStore(), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    dispatch = spyOn(TestBed.inject(MockStore), "dispatch");
    fixture = TestBed.createComponent(UserRegistrationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  /** Fills the form and lets the user-name availability check (half a second, then one request) finish. */
  function fill(values: Partial<typeof valid>, nameIsFree = true) {
    component.registrationForm.setValue({ ...valid, ...values });
    tick(500);
    const name = values.userName ?? valid.userName;
    http.expectOne("/api/user/validateUserName/" + encodeURIComponent(name)).flush(nameIsFree);
  }

  it("a complete, valid form is registered with exactly what was typed", fakeAsync(() => {
    fill({});
    expect(component.registrationForm.valid).toBeTrue();
    component.registerUser();
    expect(dispatch).toHaveBeenCalledWith(register({ userdetails: jasmine.objectContaining({ firstName: "Ada", password: "Abcdefg1" }) as never }));
  }));

  it("a taken user name blocks the form", fakeAsync(() => {
    fill({}, false);
    expect(component.registrationForm.controls.userName.errors).toEqual({ userNameNotAvailable: true });
    component.registerUser();
    expect(dispatch).not.toHaveBeenCalled();
  }));

  it("a weak password blocks the form", fakeAsync(() => {
    fill({ password: "abcdefgh", confirmPassword: "abcdefgh" });
    expect(component.registrationForm.controls.password.errors).toEqual({ passwordValidation: true });
    expect(component.registrationForm.valid).toBeFalse();
  }));

  it("a confirmation that differs blocks the form", fakeAsync(() => {
    fill({ confirmPassword: "Different1" });
    expect(component.registrationForm.controls.confirmPassword.errors).toEqual({ passwordMismatch: true });
    expect(component.registrationForm.valid).toBeFalse();
  }));

  it("does not ask the server anything until a name is typed", fakeAsync(() => {
    tick(1000);
    http.expectNone(() => true);
  }));
});
