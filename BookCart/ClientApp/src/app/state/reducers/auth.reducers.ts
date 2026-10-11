import { createReducer, on } from "@ngrx/store";
import { User } from "src/app/models/user";
import { CallState, LoadingState } from "src/app/shared/call-state";
import {
  login,
  loginFailure,
  loginSuccess,
  logout,
  resetLoginFormError,
  sessionExpired,
  sessionResolved,
  setAuthState,
} from "../actions/auth.actions";

export const AUTH_FEATURE_KEY = "appAuth";

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  /** False until the stored token has been looked at once at app start. Route guards wait for it. */
  authResolved: boolean;
  authCallState: CallState;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  authResolved: false,
  authCallState: LoadingState.INIT,
};

export const authReducer = createReducer(
  initialState,
  on(login, (state) => ({
    ...initialState,
    authResolved: state.authResolved,
  })),
  on(loginSuccess, (state) => ({
    ...state,
    authCallState: LoadingState.LOADED,
    isAuthenticated: true,
  })),
  on(setAuthState, (state, { user }) => ({
    ...state,
    user,
    isAuthenticated: true,
    authResolved: true,
  })),
  on(sessionResolved, (state) => ({
    ...state,
    authResolved: true,
  })),
  on(loginFailure, (state, { errorMessage }) => ({
    ...state,
    isAuthenticated: false,
    authResolved: true,
    authCallState: { errorMessage },
  })),
  on(logout, sessionExpired, () => ({
    ...initialState,
    authResolved: true,
  })),
  on(resetLoginFormError, (state) => ({
    ...state,
    authCallState: LoadingState.INIT,
  }))
);
