import { inject } from "@angular/core";
import { CanMatchFn, Router } from "@angular/router";
import { AuthStore } from "../state/auth/auth.store";

/**
 * Decides whether the admin routes exist for this visitor (so their code is not even downloaded for anyone else).
 * An admin passes, a signed-in non-admin goes home, a visitor who is not signed in goes to log in.
 */
export const adminGuard: CanMatchFn = (_route, segments) => {
  const router = inject(Router);
  const auth = inject(AuthStore);
  if (auth.isAdmin()) {
    return true;
  }
  if (auth.isAuthenticated()) {
    return router.createUrlTree(["/"]);
  }
  return router.createUrlTree(["/login"], {
    queryParams: {
      returnUrl: "/" + segments.map((segment) => segment.path).join("/"),
    },
  });
};
