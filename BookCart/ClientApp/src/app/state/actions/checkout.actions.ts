import { createAction, props } from "@ngrx/store";

// Nothing about the order is sent: the server prices it from its own copy of the cart.
export const placeOrder = createAction("[Checkout] Place Order");

export const placeOrderSuccess = createAction("[Checkout] Place Order Success");

export const placeOrderFailure = createAction(
  "[Checkout] Place Order Failure",
  props<{ errorMessage: string }>()
);
