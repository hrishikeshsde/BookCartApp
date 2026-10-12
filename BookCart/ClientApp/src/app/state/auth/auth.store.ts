import { HttpErrorResponse } from "@angular/common/http";
import { computed, inject } from "@angular/core";
import { Router } from "@angular/router";
import { tapResponse } from "@ngrx/operators";
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { pipe, switchMap, tap } from "rxjs";
import { User } from "src/app/models/user";
import { UserLogin } from "src/app/models/userLogin";
import { AuthenticationService } from "src/app/services/authentication.service";
import { SnackbarService } from "src/app/services/snackbar.service";
import { TokenStorage } from "src/app/services/token-storage.service";
import { errorText, INVALID_CREDENTIALS } from "src/app/shared/http-error";
import { safeReturnUrl } from "src/app/shared/return-url";
import {
  setError,
  setInit,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";

export interface LoginRequest {
  credentials: UserLogin;
  /** Where to go once logged in (checked by `safeReturnUrl`). */
  returnUrl?: string;
}

/**
 * Who is signed in. The stored token is read once, when the store is created, so the very first render already knows
 * (there is no "not looked at yet" state for the route guards to wait for). `callState` is the login attempt: its
 * `error` is `INVALID_CREDENTIALS` for a wrong user name or password, or the reason for any other failure.
 *
 * The other session-bound stores (cart, wishlist, orders) watch `userId` and reload or empty themselves; nothing here
 * knows about them.
 */
export const AuthStore = signalStore(
  { providedIn: "root" },
  withState<{ user: User | null }>({ user: null }),
  withCallState(),
  withComputed(({ user }) => ({
    isAuthenticated: computed(() => user() !== null),
    isAdmin: computed(() => user()?.userTypeName === "Admin"),
    userId: computed(() => user()?.userId ?? null),
  })),
  withMethods(
    (
      store,
      authenticationService = inject(AuthenticationService),
      tokenStorage = inject(TokenStorage),
      snackbar = inject(SnackbarService),
      router = inject(Router)
    ) => ({
      login: rxMethod<LoginRequest>(
        pipe(
          tap(() => patchState(store, setLoading())),
          switchMap(({ credentials, returnUrl }) =>
            authenticationService.login(credentials).pipe(
              tapResponse({
                next: (response) => {
                  tokenStorage.set(response.token);
                  const user = tokenStorage.user();
                  if (!user) {
                    patchState(store, setError("Invalid token"));
                    return;
                  }
                  patchState(store, { user }, setLoaded());
                  router.navigateByUrl(safeReturnUrl(returnUrl));
                },
                error: (error) =>
                  patchState(
                    store,
                    setError(
                      error instanceof HttpErrorResponse && error.status === 401
                        ? INVALID_CREDENTIALS
                        : errorText(error)
                    )
                  ),
              })
            )
          )
        )
      ),

      /** Clears an old login error (the login page does it when it opens). */
      resetLoginError() {
        patchState(store, setInit());
      },

      logout() {
        tokenStorage.clear();
        patchState(store, { user: null }, setInit());
        router.navigate(["/login"]);
      },

      /**
       * A 401 on a call that needed a login: the token is gone, expired or no longer accepted. Forget it and send the
       * visitor to log in again, back to where they were.
       */
      expireSession() {
        const hadSession = store.isAuthenticated();
        tokenStorage.clear();
        patchState(store, { user: null }, setInit());
        if (hadSession) {
          snackbar.showSnackBar(
            "Your session has expired. Please log in again."
          );
        }
        const url = router.url;
        if (!url.startsWith("/login")) {
          router.navigate(["/login"], { queryParams: { returnUrl: url } });
        }
      },
    })
  ),
  withHooks((store, tokenStorage = inject(TokenStorage)) => ({
    // The token kept from an earlier visit (if valid and not expired) is the signed-in session.
    onInit() {
      patchState(store, { user: tokenStorage.user() });
    },
  }))
);
