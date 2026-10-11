import { Action } from "@ngrx/store";
import { aUser } from "src/app/testing/fixtures";
import { login, loginFailure, loginSuccess, logout, sessionExpired, sessionResolved, setAuthState, } from "../actions/auth.actions";
import { authReducer } from "./auth.reducers";

const init = { type: "@@init" } as Action;

describe("authReducer", () => {
  it("starts as an unresolved guest", () => {
    const state = authReducer(undefined, init);
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.authResolved).toBe(false);
  });

  it("a restored session signs the user in and resolves", () => {
    const user = aUser();
    const state = authReducer(undefined, setAuthState({ user }));
    expect(state.user).toBe(user);
    expect(state.isAuthenticated).toBe(true);
    expect(state.authResolved).toBe(true);
  });

  it("finding no stored token resolves without signing anyone in", () => {
    const state = authReducer(undefined, sessionResolved());
    expect(state.authResolved).toBe(true);
    expect(state.isAuthenticated).toBe(false);
  });

  it("a successful login flags the visitor as authenticated", () => {
    expect(authReducer(undefined, loginSuccess()).isAuthenticated).toBe(true);
  });

  it("a failed login stays a guest, resolved, with the reason", () => {
    const state = authReducer(undefined, loginFailure({ errorMessage: "nope" }));
    expect(state.isAuthenticated).toBe(false);
    expect(state.authResolved).toBe(true);
    expect(state.authCallState).toEqual({ errorMessage: "nope" });
  });

  it("starting a new login clears the user and the old error but keeps what is already resolved", () => {
    const signedIn = authReducer(undefined, setAuthState({ user: aUser() }));
    const state = authReducer(signedIn, login({ loginCredentials: { username: "u", password: "p" } }));
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.authResolved).toBe(true);
  });

  for (const [name, action] of [
    ["logout", logout()],
    ["sessionExpired", sessionExpired({ hadSession: true })],
  ] as const) {
    it(`${name} forgets the user and leaves the guards free to decide`, () => {
      const signedIn = authReducer(undefined, setAuthState({ user: aUser() }));
      const state = authReducer(signedIn, action);
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.authResolved).toBe(true);
    });
  }
});
