import { inject, Injectable } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap, tap } from "rxjs";
import { CartService } from "src/app/services/cart.service";
import { SnackbarService } from "src/app/services/snackbar.service";
import { setAuthState } from "../actions/auth.actions";
import {
  addToCart,
  addToCartFailure,
  addToCartSuccess,
  clearCart,
  clearCartFailure,
  clearCartSuccess,
  loadCart,
  loadCartFailure,
  loadCartSuccess,
  reduceCartQuantity,
  reduceCartQuantityFailure,
  reduceCartQuantitySuccess,
  removeCartItem,
  removeCartItemFailure,
  removeCartItemSuccess,
} from "../actions/cart.actions";

/**
 * None of these calls names a user: the server works out whose cart it is from the login token, or else from the
 * cookie it gave the visitor when the first book was added.
 */
@Injectable()
export class CartEffects {
  private readonly actions$ = inject(Actions);
  private readonly cartService = inject(CartService);
  private readonly snackbarService = inject(SnackbarService);

  loadCart$ = createEffect(() =>
    this.actions$.pipe(
      // setAuthState: logging in merges the guest cart into the user's on the server, so load what it ended up as.
      ofType(loadCart, setAuthState),
      switchMap(() =>
        this.cartService.getCartItems().pipe(
          map((shoppingCart) => loadCartSuccess({ shoppingCart })),
          catchError((error) => of(loadCartFailure({ errorMessage: error })))
        )
      )
    )
  );

  addToCart$ = createEffect(() =>
    this.actions$.pipe(
      ofType(addToCart),
      switchMap((action) =>
        this.cartService.addBookToCart(action.bookId).pipe(
          map((shoppingCart) => addToCartSuccess({ shoppingCart })),
          tap(() => {
            this.snackbarService.showSnackBar("One Item added to cart");
          }),
          catchError((error) => of(addToCartFailure({ errorMessage: error })))
        )
      )
    )
  );

  removeCartItem$ = createEffect(() =>
    this.actions$.pipe(
      ofType(removeCartItem),
      switchMap((action) =>
        this.cartService.removeBookFromCart(action.bookId).pipe(
          map((shoppingCart) => removeCartItemSuccess({ shoppingCart })),
          tap(() => {
            this.snackbarService.showSnackBar("Book removed from cart");
          }),
          catchError((error) =>
            of(removeCartItemFailure({ errorMessage: error }))
          )
        )
      )
    )
  );

  reduceCartQuantity$ = createEffect(() =>
    this.actions$.pipe(
      ofType(reduceCartQuantity),
      switchMap((action) =>
        this.cartService.reduceCartQuantity(action.bookId).pipe(
          map((shoppingCart) => reduceCartQuantitySuccess({ shoppingCart })),
          tap(() => {
            this.snackbarService.showSnackBar("One item removed from cart");
          }),
          catchError((error) =>
            of(reduceCartQuantityFailure({ errorMessage: error }))
          )
        )
      )
    )
  );

  clearCart$ = createEffect(() =>
    this.actions$.pipe(
      ofType(clearCart),
      switchMap(() =>
        this.cartService.clearCart().pipe(
          map(() => clearCartSuccess()),
          tap(() => {
            this.snackbarService.showSnackBar("Cart cleared");
          }),
          catchError((error) => of(clearCartFailure({ errorMessage: error })))
        )
      )
    )
  );
}
