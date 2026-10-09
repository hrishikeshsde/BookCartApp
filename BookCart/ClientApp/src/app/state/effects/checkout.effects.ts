import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { Store } from "@ngrx/store";
import { catchError, map, of, switchMap, tap } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { CheckoutService } from "../../services/checkout.service";
import { loadCart } from "../actions/cart.actions";
import {
  placeOrder,
  placeOrderFailure,
  placeOrderSuccess,
} from "../actions/checkout.actions";

@Injectable()
export class CheckoutEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly checkoutService = inject(CheckoutService);
  private readonly snackbarService = inject(SnackbarService);
  private readonly router = inject(Router);

  placeOrder$ = createEffect(() =>
    this.actions$.pipe(
      ofType(placeOrder),
      // The server orders what is in its copy of the cart at its prices; nothing about the order is sent.
      switchMap(() =>
        this.checkoutService.placeOrder().pipe(
          map(() => placeOrderSuccess()),
          catchError((error) => of(placeOrderFailure({ errorMessage: error })))
        )
      )
    )
  );

  handleSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(placeOrderSuccess),
        tap(() => {
          this.snackbarService.showSnackBar("Order placed successfully!!!");
          this.router.navigate(["/myorders"]);
          // The server emptied the cart as part of placing the order; show that.
          this.store.dispatch(loadCart());
        })
      ),
    { dispatch: false }
  );

  handleFailure$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(placeOrderFailure),
        tap(() => {
          this.snackbarService.showSnackBar(
            "The order could not be placed. Your cart may be empty or have changed: please review it and try again."
          );
          this.store.dispatch(loadCart());
        })
      ),
    { dispatch: false }
  );
}
