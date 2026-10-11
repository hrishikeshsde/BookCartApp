import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { Store } from "@ngrx/store";
import { filter, map, switchMap, take } from "rxjs";
import {
  selectAuthResolved,
  selectIsAuthenticated,
} from "../state/selectors/auth.selectors";

/** Lets a signed-in visitor through; anyone else goes to the login page and comes back to where they were headed. */
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const store = inject(Store);
  return store.select(selectAuthResolved).pipe(
    filter(Boolean),
    take(1),
    switchMap(() => store.select(selectIsAuthenticated)),
    take(1),
    map((signedIn) =>
      signedIn
        ? true
        : router.createUrlTree(["/login"], {
            queryParams: { returnUrl: state.url },
          })
    )
  );
};
