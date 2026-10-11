import { createFeatureSelector, createSelector } from "@ngrx/store";
import { AUTH_FEATURE_KEY, AuthState } from "../reducers/auth.reducers";
import { getCallStateError } from "src/app/shared/call-state";

const selectAuthFeatureState =
  createFeatureSelector<AuthState>(AUTH_FEATURE_KEY);

export const selectIsAuthenticated = createSelector(
  selectAuthFeatureState,
  (state: AuthState) => state.isAuthenticated
);

export const selectAuthenticatedUser = createSelector(
  selectAuthFeatureState,
  (state) => state.user
);

/** True once the token stored from an earlier visit has been looked at (see restoreSession). */
export const selectAuthResolved = createSelector(
  selectAuthFeatureState,
  (state) => state.authResolved
);

export const selectIsAdmin = createSelector(
  selectAuthenticatedUser,
  (user) => user?.userTypeName === "Admin"
);

export const selectLoginError = createSelector(
  selectAuthFeatureState,
  (state) => getCallStateError(state.authCallState)
);
