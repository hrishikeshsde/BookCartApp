import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { throwError } from "rxjs";
import { catchError } from "rxjs/operators";
import { SnackbarService } from "../services/snackbar.service";
import { AuthStore } from "../state/auth/auth.store";

/**
 * Turns the answers that need the whole app's attention into one reaction each, and always passes the original
 * HttpErrorResponse on (status and problem details intact) so callers can decide for themselves.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStore);
  const snackbar = inject(SnackbarService);
  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !request.url.endsWith("/api/login")) {
        // A wrong password at login is a 401 too, but the login page handles that one.
        auth.expireSession();
      } else if (error.status === 403) {
        snackbar.showSnackBar("You do not have permission to do that.");
      } else if (error.status >= 500) {
        snackbar.showSnackBar("Something went wrong. Please try again.");
      }
      return throwError(() => error);
    })
  );
};
