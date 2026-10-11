import { inject } from "@angular/core";
import { CanMatchFn, Router } from "@angular/router";
import { Store } from "@ngrx/store";
import { filter, map, switchMap, take } from "rxjs";
import {
  selectAuthenticatedUser,
  selectAuthResolved,
} from "../state/selectors/auth.selectors";

/**
 * Decides whether the admin routes exist for this visitor (so their code is not even downloaded for anyone else).
 * An admin passes, a signed-in non-admin goes home, a visitor who is not signed in goes to log in.
 */
export const adminGuard: CanMatchFn = (_route, segments) => {
  const router = inject(Router);
  const store = inject(Store);
  return store.select(selectAuthResolved).pipe(
    filter(Boolean),
    take(1),
    switchMap(() => store.select(selectAuthenticatedUser)),
    take(1),
    map((user) => {
      if (user?.userTypeName === "Admin") {
        return true;
      }
      if (user) {
        return router.createUrlTree(["/"]);
      }
      return router.createUrlTree(["/login"], {
        queryParams: {
          returnUrl: "/" + segments.map((segment) => segment.path).join("/"),
        },
      });
    })
  );
};
