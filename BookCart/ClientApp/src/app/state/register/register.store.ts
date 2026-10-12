import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { tapResponse } from "@ngrx/operators";
import { patchState, signalStore, withMethods } from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { pipe, switchMap, tap } from "rxjs";
import { UserRegistration } from "src/app/models/userRegistration";
import { SnackbarService } from "src/app/services/snackbar.service";
import { UserService } from "src/app/services/user.service";
import { errorText } from "src/app/shared/http-error";
import {
  setError,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";

/** Signing up: on success the visitor goes on to the login page. */
export const RegisterStore = signalStore(
  { providedIn: "root" },
  withCallState(),
  withMethods(
    (
      store,
      userService = inject(UserService),
      snackbar = inject(SnackbarService),
      router = inject(Router)
    ) => ({
      register: rxMethod<UserRegistration>(
        pipe(
          tap(() => patchState(store, setLoading())),
          switchMap((userdetails) =>
            userService.registerUser(userdetails).pipe(
              tapResponse({
                next: () => {
                  patchState(store, setLoaded());
                  snackbar.showSnackBar("Registration successful");
                  router.navigate(["/login"]);
                },
                error: (error) => {
                  patchState(store, setError(errorText(error)));
                  console.error(
                    "Error occurred during user registration:",
                    errorText(error)
                  );
                  snackbar.showSnackBar("An error occurred. Please try again.");
                },
              })
            )
          )
        )
      ),
    })
  )
);
