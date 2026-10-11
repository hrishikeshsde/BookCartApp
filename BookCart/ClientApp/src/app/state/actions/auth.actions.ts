import { createAction, props } from "@ngrx/store";
import { User } from "src/app/models/user";
import { UserLogin } from "src/app/models/userLogin";
import { UserRegistration } from "src/app/models/userRegistration";

export const login = createAction(
  "[Auth] Login",
  props<{ loginCredentials: UserLogin }>()
);
export const loginSuccess = createAction("[Auth] Login Success");

export const setAuthState = createAction(
  "[Auth] Set State Post Login Success",
  props<{ user: User }>()
);

export const loginFailure = createAction(
  "[Auth] Login Failure",
  props<{ errorMessage: string }>()
);

export const resetLoginFormError = createAction("[Auth] Login Error Reset");

export const logout = createAction("[Auth] Logout");

/** App start: pick up the session the stored token describes (or find out there is none). */
export const restoreSession = createAction("[Auth] Restore Session");

/** There was no usable stored token, so the visitor is a guest. Lets the route guards stop waiting. */
export const sessionResolved = createAction("[Auth] Session Resolved");

/** The server answered 401 to a request that needed a login: the token is gone, expired or no longer accepted. */
export const sessionExpired = createAction(
  "[Auth] Session Expired",
  props<{ hadSession: boolean }>()
);

export const register = createAction(
  "[Auth] Register",
  props<{ userdetails: UserRegistration }>()
);

export const registerSuccess = createAction("[Auth] Register Success");

export const registerFailure = createAction(
  "[Auth] Register Failure",
  props<{ errorMessage: string }>()
);
