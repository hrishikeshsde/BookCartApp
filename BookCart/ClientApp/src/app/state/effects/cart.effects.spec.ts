import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { Subject } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { aCartItem, aUser } from "src/app/testing/fixtures";
import { collect, SnackbarStub } from "src/app/testing/helpers";
import { setAuthState } from "../actions/auth.actions";
import {
  addToCart,
  addToCartFailure,
  addToCartSuccess,
  loadCart,
  loadCartSuccess,
  removeCartItem,
  removeCartItemSuccess,
} from "../actions/cart.actions";
import { CartEffects } from "./cart.effects";

describe("CartEffects", () => {
  let actions$: Subject<Action>;
  let effects: CartEffects;
  let http: HttpTestingController;
  let snackbar: SnackbarStub;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        CartEffects,
        provideMockActions(() => actions$),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    effects = TestBed.inject(CartEffects);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it("loads the cart on request", () => {
    const out = collect(effects.loadCart$);
    actions$.next(loadCart());
    http.expectOne("/api/shoppingcart").flush([aCartItem(1)]);
    expect(out).toEqual([loadCartSuccess({ shoppingCart: [aCartItem(1)] })]);
  });

  it("loads the cart again after a login, because the server merged the guest cart into it", () => {
    const out = collect(effects.loadCart$);
    actions$.next(setAuthState({ user: aUser() }));
    http.expectOne("/api/shoppingcart").flush([aCartItem(1, 2)]);
    expect(out).toEqual([loadCartSuccess({ shoppingCart: [aCartItem(1, 2)] })]);
  });

  it("adds a book and tells the visitor", () => {
    const out = collect(effects.addToCart$);
    actions$.next(addToCart({ bookId: 5 }));
    const request = http.expectOne("/api/shoppingcart/items/5");
    expect(request.request.method).toBe("POST");
    request.flush([aCartItem(5)]);
    expect(out).toEqual([addToCartSuccess({ shoppingCart: [aCartItem(5)] })]);
    expect(snackbar.messages).toEqual(["One Item added to cart"]);
  });

  it("an unknown book is a failure with a readable message", () => {
    const out = collect(effects.addToCart$);
    actions$.next(addToCart({ bookId: 404 }));
    http
      .expectOne("/api/shoppingcart/items/404")
      .flush({ detail: "No such book." }, { status: 404, statusText: "Not Found" });
    expect(out).toEqual([addToCartFailure({ errorMessage: "No such book." })]);
  });

  it("removes a book", () => {
    const out = collect(effects.removeCartItem$);
    actions$.next(removeCartItem({ bookId: 5 }));
    const request = http.expectOne("/api/shoppingcart/items/5");
    expect(request.request.method).toBe("DELETE");
    request.flush([]);
    expect(out).toEqual([removeCartItemSuccess({ shoppingCart: [] })]);
  });
});
