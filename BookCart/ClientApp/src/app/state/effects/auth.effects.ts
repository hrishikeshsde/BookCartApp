import { HttpErrorResponse } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap, tap } from "rxjs";
import { AuthenticationService } from "src/app/services/authentication.service";
import { SnackbarService } from "src/app/services/snackbar.service";
import { TokenStorage } from "src/app/services/token-storage.service";
import { errorText, INVALID_CREDENTIALS } from "src/app/shared/http-error";
import { safeReturnUrl } from "src/app/shared/return-url";
import {
  login,
  loginFailure,
  loginSuccess,
  logout,
  restoreSession,
  sessionExpired,
  sessionResolved,
  setAuthState,
} from "../actions/auth.actions";

@Injectable()
export class AuthEffects {
  private readonly actions$ = inject(Actions);
  private readonly authenticationService = inject(AuthenticationService);
  private readonly router = inject(Router);
  private readonly tokenStorage = inject(TokenStorage);
  private readonly snackbarService = inject(SnackbarService);

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(login),
      switchMap((action) =>
        this.authenticationService.login(action.loginCredentials).pipe(
          map((response) => {
            this.tokenStorage.set(response.token);
            this.router.navigateByUrl(safeReturnUrl(action.returnUrl));
            return loginSuccess();
          }),
          catchError((error: unknown) =>
            of(
              loginFailure({
                errorMessage:
                  error instanceof HttpErrorResponse && error.status === 401
                    ? INVALID_CREDENTIALS
                    : errorText(error),
              })
            )
          )
        )
      )
    )
  );

  logout$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(logout),
        tap(() => {
          this.tokenStorage.clear();
          this.router.navigate(["/login"]);
        })
      ),
    { dispatch: false }
  );

  /** A 401 on a call that needed a login: forget the token and send the visitor to log in again, back to where they were. */
  sessionExpired$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(sessionExpired),
        tap(({ hadSession }) => {
          this.tokenStorage.clear();
          if (hadSession) {
            this.snackbarService.showSnackBar(
              "Your session has expired. Please log in again."
            );
          }
          const url = this.router.url;
          if (!url.startsWith("/login")) {
            this.router.navigate(["/login"], {
              queryParams: { returnUrl: url },
            });
          }
        })
      ),
    { dispatch: false }
  );

  /** App start: the token kept from an earlier visit decides whether this is a signed-in session. */
  restoreSession$ = createEffect(() =>
    this.actions$.pipe(
      ofType(restoreSession),
      map(() => {
        const user = this.tokenStorage.user();
        return user ? setAuthState({ user }) : sessionResolved();
      })
    )
  );

  handleLoginSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loginSuccess),
      map(() => {
        const user = this.tokenStorage.user();
        return user
          ? setAuthState({ user })
          : loginFailure({ errorMessage: "Invalid token" });
      })
    )
  );
}
