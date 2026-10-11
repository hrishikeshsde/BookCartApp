import { LoadingState } from "src/app/shared/call-state";
import { aBook } from "src/app/testing/fixtures";
import { logout, sessionExpired } from "../actions/auth.actions";
import {
  clearWishlistSuccess,
  loadWishlistFailure,
  loadWishlistSuccess,
  toggleWishlistItemSuccess,
} from "../actions/wishlist.actions";
import { wishlistReducer } from "./wishlist.reducers";

describe("wishlistReducer", () => {
  it("takes the list the server answers with", () => {
    let state = wishlistReducer(undefined, loadWishlistSuccess({ wishlist: [aBook(1)] }));
    expect(state.wishlist.length).toBe(1);
    expect(state.wishlistCallState).toBe(LoadingState.LOADED);
    state = wishlistReducer(state, toggleWishlistItemSuccess({ wishlist: [aBook(1), aBook(2)] }));
    expect(state.wishlist.map((b) => b.bookId)).toEqual([1, 2]);
  });

  it("keeps the list on a failure", () => {
    const loaded = wishlistReducer(undefined, loadWishlistSuccess({ wishlist: [aBook(1)] }));
    const state = wishlistReducer(loaded, loadWishlistFailure({ errorMessage: "x" }));
    expect(state.wishlist.length).toBe(1);
    expect(state.wishlistCallState).toEqual({ errorMessage: "x" });
  });

  it("clearing, logout and an expired session all empty it", () => {
    const loaded = wishlistReducer(undefined, loadWishlistSuccess({ wishlist: [aBook(1)] }));
    expect(wishlistReducer(loaded, clearWishlistSuccess()).wishlist).toEqual([]);
    expect(wishlistReducer(loaded, logout()).wishlist).toEqual([]);
    expect(wishlistReducer(loaded, sessionExpired({ hadSession: true })).wishlist).toEqual([]);
  });
});
