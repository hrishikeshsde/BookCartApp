import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { Subject } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { collect, SnackbarStub } from "src/app/testing/helpers";
import { register, registerFailure, registerSuccess } from "../actions/auth.actions";
import { RegisterEffects } from "./register.effects";

const details = { firstName: "A", lastName: "B", username: "ab", password: "Abcdefg1", gender: "Male" };

describe("RegisterEffects", () => {
  let actions$: Subject<Action>;
  let effects: RegisterEffects;
  let http: HttpTestingController;
  let snackbar: SnackbarStub;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        RegisterEffects,
        provideMockActions(() => actions$),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    effects = TestBed.inject(RegisterEffects);
    http = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), "navigate").and.resolveTo(true);
  });
  afterEach(() => http.verify());

  it("registers with the details given", () => {
    const out = collect(effects.register$);
    actions$.next(register({ userdetails: details }));
    const request = http.expectOne("/api/user/");
    expect(request.request.body).toEqual(details);
    request.flush(null);
    expect(out).toEqual([registerSuccess()]);
  });

  it("a taken name comes back as the server's own words", () => {
    const out = collect(effects.register$);
    actions$.next(register({ userdetails: details }));
    http
      .expectOne("/api/user/")
      .flush({ detail: "That username is already taken." }, { status: 409, statusText: "Conflict" });
    expect(out).toEqual([registerFailure({ errorMessage: "That username is already taken." })]);
  });

  it("after success the visitor is told and sent to log in", () => {
    effects.handleRegisterSuccess$.subscribe();
    actions$.next(registerSuccess());
    expect(snackbar.messages).toEqual(["Registration successful"]);
    expect(navigate).toHaveBeenCalledWith(["/login"]);
  });

  it("after a failure the visitor is told to try again", () => {
    spyOn(console, "error");
    effects.handleRegisterFailure$.subscribe();
    actions$.next(registerFailure({ errorMessage: "x" }));
    expect(snackbar.messages).toEqual(["An error occurred. Please try again."]);
  });
});
