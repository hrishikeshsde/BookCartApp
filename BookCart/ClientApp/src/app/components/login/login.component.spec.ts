import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { INVALID_CREDENTIALS } from "src/app/shared/http-error";
import { AuthStore } from "src/app/state/auth/auth.store";
import { fakeAuthStore } from "src/app/testing/fake-stores";
import { LoginComponent } from "./login.component";

describe("LoginComponent", () => {
  let fixture: ComponentFixture<LoginComponent>;
  let auth: ReturnType<typeof fakeAuthStore>;
  const root = () => fixture.nativeElement as HTMLElement;
  const input = (name: string) => root().querySelector(`input[formcontrolname="${name}"]`) as HTMLInputElement;
  const type = (name: string, value: string) => {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event("input"));
  };
  const submit = () => (root().querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit"));

  beforeEach(() => {
    auth = fakeAuthStore();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthStore, useValue: auth }],
    });
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  it("clears an old login error when the page opens", () => {
    expect(auth.resetLoginError).toHaveBeenCalledTimes(1);
  });

  it("does not try to log in with an empty form", () => {
    submit();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("logs in with what was typed", () => {
    type("username", "reader");
    type("password", "Abcdefg1");
    submit();
    expect(auth.login).toHaveBeenCalledWith({ credentials: { username: "reader", password: "Abcdefg1" }, returnUrl: undefined });
  });

  it("passes on where the visitor was headed", () => {
    fixture.componentRef.setInput("returnUrl", "/wishlist");
    type("username", "reader");
    type("password", "Abcdefg1");
    submit();
    expect(auth.login).toHaveBeenCalledWith({ credentials: { username: "reader", password: "Abcdefg1" }, returnUrl: "/wishlist" });
  });

  it("says the user name or password is wrong after a 401", () => {
    auth.callState.set({ error: INVALID_CREDENTIALS });
    fixture.detectChanges();
    expect(root().textContent).toContain("Username or Password is incorrect");
  });

  it("empties the form after a wrong password", () => {
    type("username", "reader");
    type("password", "wrong");
    auth.callState.set({ error: INVALID_CREDENTIALS });
    fixture.detectChanges();
    expect(input("username").value).toBe("");
    expect(input("password").value).toBe("");
  });

  it("gives the reason for any other failure instead of showing nothing", () => {
    auth.callState.set({ error: "Too Many Requests" });
    fixture.detectChanges();
    expect(root().textContent).toContain("Login failed: Too Many Requests");
    expect(root().textContent).not.toContain("Username or Password is incorrect");
  });
});
