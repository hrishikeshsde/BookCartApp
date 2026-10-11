import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { INVALID_CREDENTIALS } from "src/app/shared/http-error";
import { login, resetLoginFormError } from "src/app/state/actions/auth.actions";
import { selectLoginError } from "src/app/state/selectors/auth.selectors";
import { LoginComponent } from "./login.component";

describe("LoginComponent", () => {
  let fixture: ComponentFixture<LoginComponent>;
  let store: MockStore;
  let dispatch: jasmine.Spy;
  const root = () => fixture.nativeElement as HTMLElement;
  const input = (name: string) => root().querySelector(`input[formcontrolname="${name}"]`) as HTMLInputElement;
  const type = (name: string, value: string) => {
    const field = input(name);
    field.value = value;
    field.dispatchEvent(new Event("input"));
  };
  const submit = () => (root().querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit"));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideMockStore({ selectors: [{ selector: selectLoginError, value: null }] })],
    });
    store = TestBed.inject(MockStore);
    dispatch = spyOn(store, "dispatch");
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("clears an old login error when the page opens", () => {
    expect(dispatch).toHaveBeenCalledWith(resetLoginFormError());
  });

  it("does not try to log in with an empty form", () => {
    submit();
    expect(dispatch).not.toHaveBeenCalledWith(jasmine.objectContaining({ type: login.type }));
  });

  it("logs in with what was typed", () => {
    type("username", "reader");
    type("password", "Abcdefg1");
    submit();
    expect(dispatch).toHaveBeenCalledWith(login({ loginCredentials: { username: "reader", password: "Abcdefg1" } }));
  });

  it("says the user name or password is wrong after a 401", () => {
    store.overrideSelector(selectLoginError, INVALID_CREDENTIALS);
    store.refreshState();
    fixture.detectChanges();
    expect(root().textContent).toContain("Username or Password is incorrect");
  });

  it("gives the reason for any other failure instead of showing nothing", () => {
    store.overrideSelector(selectLoginError, "Too Many Requests");
    store.refreshState();
    fixture.detectChanges();
    expect(root().textContent).toContain("Login failed: Too Many Requests");
    expect(root().textContent).not.toContain("Username or Password is incorrect");
  });
});
