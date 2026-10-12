import { computed, effect, inject, untracked } from "@angular/core";
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
import { filter, pipe, switchMap, tap } from "rxjs";
import { Book } from "src/app/models/book";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { SnackbarService } from "src/app/services/snackbar.service";
import { WishlistService } from "src/app/services/wishlist.service";
import { errorText } from "src/app/shared/http-error";
import {
  setError,
  setInit,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";
import { AuthStore } from "../auth/auth.store";

/**
 * The signed-in user's wishlist. It loads when someone signs in (or the app starts with a stored session) and empties
 * itself when they leave. Every call needs a login; without one it records "User not found" and sends nothing.
 */
export const WishlistStore = signalStore(
  { providedIn: "root" },
  withState<{ items: Book[] }>({ items: [] }),
  withCallState(),
  withComputed(({ items }) => ({
    count: computed(() => items().length),
    /** The ids of the wishlisted books, for a "is this one on it?" check per card. */
    ids: computed(() => new Set(items().map((book) => book.bookId))),
  })),
  withMethods(
    (
      store,
      auth = inject(AuthStore),
      wishlistService = inject(WishlistService),
      snackbar = inject(SnackbarService)
    ) => {
      const signedIn = () => {
        if (auth.isAuthenticated()) {
          return true;
        }
        patchState(store, setError("User not found"));
        return false;
      };

      return {
        /** Fetches the wishlist again (the wishlist page does this each time it opens). */
        load: rxMethod<void>(
          pipe(
            filter(signedIn),
            tap(() => patchState(store, setLoading())),
            switchMap(() =>
              wishlistService.getWishlistItems().pipe(
                tapResponse({
                  next: (items) => patchState(store, { items }, setLoaded()),
                  error: (error) =>
                    patchState(store, setError(errorText(error))),
                })
              )
            )
          )
        ),

        /** Adds the book to the wishlist, or takes it off (`isAdd` only picks the message: the server toggles). */
        toggle: rxMethod<WishlistToggle>(
          pipe(
            filter(signedIn),
            tap(() => patchState(store, setLoading())),
            switchMap(({ bookId, isAdd }) =>
              wishlistService.toggleWishlistItem(bookId).pipe(
                tapResponse({
                  next: (items) => {
                    patchState(store, { items }, setLoaded());
                    snackbar.showSnackBar(
                      isAdd ? "Added to Wishlist!!!" : "Removed from Wishlist!!!"
                    );
                  },
                  error: (error) =>
                    patchState(store, setError(errorText(error))),
                })
              )
            )
          )
        ),

        clear: rxMethod<void>(
          pipe(
            filter(signedIn),
            tap(() => patchState(store, setLoading())),
            switchMap(() =>
              wishlistService.clearWishlist().pipe(
                tapResponse({
                  next: () => {
                    patchState(store, { items: [] }, setLoaded());
                    snackbar.showSnackBar("Wishlist cleared!!!");
                  },
                  error: (error) => {
                    console.error(
                      "Error ocurred while removing items from the Wishlist : ",
                      error
                    );
                    patchState(store, setError(errorText(error)));
                  },
                })
              )
            )
          )
        ),
      };
    }
  ),
  withHooks((store, auth = inject(AuthStore)) => ({
    onInit() {
      // Signing in loads the wishlist; signing out (or an expired session) takes it away.
      effect(() => {
        const userId = auth.userId();
        untracked(() => {
          if (userId === null) {
            patchState(store, { items: [] }, setInit());
          } else {
            store.load();
          }
        });
      });
    },
  }))
);
