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
import { pipe, switchMap, tap } from "rxjs";
import { ShoppingCart } from "src/app/models/shoppingcart";
import { CartService } from "src/app/services/cart.service";
import { SnackbarService } from "src/app/services/snackbar.service";
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
 * The shopping cart. None of the calls names a user: the server works out whose cart it is from the login token, or
 * else from the cookie it gave the visitor when the first book was added.
 *
 * It loads when the store is created (the nav bar shows the badge from the start) and again whenever someone signs in
 * (the server merges the guest cart into theirs, so what it ended up as is what to show). Signing out empties it.
 */
export const CartStore = signalStore(
  { providedIn: "root" },
  withState<{ items: ShoppingCart[] }>({ items: [] }),
  withCallState(),
  withComputed(({ items }) => ({
    /** Copies of books in the cart (the badge), not lines. */
    count: computed(() =>
      items().reduce((count, item) => count + item.quantity, 0)
    ),
    total: computed(() =>
      items().reduce((total, item) => total + item.book.price * item.quantity, 0)
    ),
  })),
  withMethods(
    (
      store,
      cartService = inject(CartService),
      snackbar = inject(SnackbarService)
    ) => {
      /** One call that answers with the whole cart: show it, then say what happened. */
      const withCart = (message: string | null) =>
        tapResponse<ShoppingCart[], unknown>({
          next: (items) => {
            patchState(store, { items }, setLoaded());
            if (message) {
              snackbar.showSnackBar(message);
            }
          },
          error: (error) => patchState(store, setError(errorText(error))),
        });

      return {
        load: rxMethod<void>(
          pipe(
            tap(() => patchState(store, setLoading())),
            switchMap(() => cartService.getCartItems().pipe(withCart(null)))
          )
        ),

        add: rxMethod<number>(
          pipe(
            tap(() => patchState(store, setLoading())),
            switchMap((bookId) =>
              cartService
                .addBookToCart(bookId)
                .pipe(withCart("One Item added to cart"))
            )
          )
        ),

        /** Takes the book out of the cart whatever its quantity. */
        remove: rxMethod<number>(
          pipe(
            tap(() => patchState(store, setLoading())),
            switchMap((bookId) =>
              cartService
                .removeBookFromCart(bookId)
                .pipe(withCart("Book removed from cart"))
            )
          )
        ),

        /** One copy fewer. */
        reduce: rxMethod<number>(
          pipe(
            tap(() => patchState(store, setLoading())),
            switchMap((bookId) =>
              cartService
                .reduceCartQuantity(bookId)
                .pipe(withCart("One item removed from cart"))
            )
          )
        ),

        clear: rxMethod<void>(
          pipe(
            tap(() => patchState(store, setLoading())),
            switchMap(() =>
              cartService.clearCart().pipe(
                tapResponse({
                  next: () => {
                    patchState(store, { items: [] }, setLoaded());
                    snackbar.showSnackBar("Cart cleared");
                  },
                  error: (error) =>
                    patchState(store, setError(errorText(error))),
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
      let first = true;
      effect(() => {
        const userId = auth.userId();
        untracked(() => {
          if (userId === null && !first) {
            // Signed out: the cart belonged to that person.
            patchState(store, { items: [] }, setInit());
          } else {
            store.load();
          }
          first = false;
        });
      });
    },
  }))
);
