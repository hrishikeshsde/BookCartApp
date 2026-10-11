import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { Subject } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { collect, SnackbarStub } from "src/app/testing/helpers";
import { loadCart } from "../actions/cart.actions";
import { placeOrder, placeOrderFailure, placeOrderSuccess } from "../actions/checkout.actions";
import { CheckoutEffects } from "./checkout.effects";

describe("CheckoutEffects", () => {
  let actions$: Subject<Action>;
  let effects: CheckoutEffects;
  let http: HttpTestingController;
  let store: MockStore;
  let snackbar: SnackbarStub;
  let navigate: jasmine.Spy;
  let dispatch: jasmine.Spy;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        CheckoutEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    effects = TestBed.inject(CheckoutEffects);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MockStore);
    dispatch = spyOn(store, "dispatch");
    navigate = spyOn(TestBed.inject(Router), "navigate").and.resolveTo(true);
  });
  afterEach(() => http.verify());

  it("places the order with nothing but the request (the server prices it)", () => {
    const out = collect(effects.placeOrder$);
    actions$.next(placeOrder());
    const request = http.expectOne("/api/checkout");
    expect(request.request.body).toEqual({});
    request.flush({ orderId: "abc" });
    expect(out).toEqual([placeOrderSuccess()]);
  });

  it("an order the server refuses (an empty cart, say) is a failure", () => {
    const out = collect(effects.placeOrder$);
    actions$.next(placeOrder());
    http.expectOne("/api/checkout").flush({ title: "Conflict" }, { status: 409, statusText: "Conflict" });
    expect(out).toEqual([placeOrderFailure({ errorMessage: "Conflict" })]);
  });

  it("after a success: confirms, shows the orders and reloads the (now empty) cart", () => {
    effects.handleSuccess$.subscribe();
    actions$.next(placeOrderSuccess());
    expect(snackbar.messages).toEqual(["Order placed successfully!!!"]);
    expect(navigate).toHaveBeenCalledWith(["/myorders"]);
    expect(dispatch).toHaveBeenCalledWith(loadCart());
  });

  it("after a failure: explains and reloads the cart so the screen shows what the server has", () => {
    effects.handleFailure$.subscribe();
    actions$.next(placeOrderFailure({ errorMessage: "x" }));
    expect(snackbar.messages.length).toBe(1);
    expect(dispatch).toHaveBeenCalledWith(loadCart());
  });
});
