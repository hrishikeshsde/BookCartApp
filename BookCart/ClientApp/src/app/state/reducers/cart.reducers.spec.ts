import { Action } from "@ngrx/store";
import { LoadingState } from "src/app/shared/call-state";
import { aCartItem } from "src/app/testing/fixtures";
import { logout, sessionExpired } from "../actions/auth.actions";
import {
  addToCart,
  addToCartFailure,
  addToCartSuccess,
  clearCartSuccess,
  loadCart,
  loadCartSuccess,
  removeCartItemSuccess,
  reduceCartQuantitySuccess,
} from "../actions/cart.actions";
import { cartReducer } from "./cart.reducers";

const init = { type: "@@init" } as Action;

describe("cartReducer", () => {
  it("shows loading while a call is in flight", () => {
    expect(cartReducer(undefined, loadCart()).cartCallState).toBe(LoadingState.LOADING);
    expect(cartReducer(undefined, addToCart({ bookId: 1 })).cartCallState).toBe(LoadingState.LOADING);
  });

  it("takes the cart the server answers with (load, add, remove, reduce)", () => {
    const first = [aCartItem(1, 1)];
    const second = [aCartItem(1, 2), aCartItem(2, 1)];
    let state = cartReducer(undefined, loadCartSuccess({ shoppingCart: first }));
    expect(state.shoppingCart).toEqual(first);
    expect(state.cartCallState).toBe(LoadingState.LOADED);

    state = cartReducer(state, addToCartSuccess({ shoppingCart: second }));
    expect(state.shoppingCart).toEqual(second);

    state = cartReducer(state, reduceCartQuantitySuccess({ shoppingCart: first }));
    expect(state.shoppingCart).toEqual(first);

    state = cartReducer(state, removeCartItemSuccess({ shoppingCart: [] }));
    expect(state.shoppingCart).toEqual([]);
  });

  it("keeps the cart on a failure and records why", () => {
    const loaded = cartReducer(undefined, loadCartSuccess({ shoppingCart: [aCartItem(1)] }));
    const state = cartReducer(loaded, addToCartFailure({ errorMessage: "not found" }));
    expect(state.shoppingCart.length).toBe(1);
    expect(state.cartCallState).toEqual({ errorMessage: "not found" });
  });

  it("clearing empties the cart", () => {
    const loaded = cartReducer(undefined, loadCartSuccess({ shoppingCart: [aCartItem(1)] }));
    expect(cartReducer(loaded, clearCartSuccess()).shoppingCart).toEqual([]);
  });

  for (const [name, action] of [
    ["logout", logout()],
    ["sessionExpired", sessionExpired({ hadSession: false })],
  ] as const) {
    it(`${name} empties the cart and starts over`, () => {
      const loaded = cartReducer(undefined, loadCartSuccess({ shoppingCart: [aCartItem(1)] }));
      const state = cartReducer(loaded, action);
      expect(state.shoppingCart).toEqual([]);
      expect(state.cartCallState).toBe(LoadingState.INIT);
    });
  }

  it("starts empty", () => {
    expect(cartReducer(undefined, init).shoppingCart).toEqual([]);
  });
});
