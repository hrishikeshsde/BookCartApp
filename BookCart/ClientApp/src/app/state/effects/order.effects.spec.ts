import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { Subject } from "rxjs";
import { aUser } from "src/app/testing/fixtures";
import { collect } from "src/app/testing/helpers";
import { loadOrders, loadOrdersFailure, loadOrdersSuccess } from "../actions/order.actions";
import { selectAuthenticatedUser } from "../selectors/auth.selectors";
import { OrderEffects } from "./order.effects";

describe("OrderEffects", () => {
  let actions$: Subject<Action>;
  let effects: OrderEffects;
  let http: HttpTestingController;
  let store: MockStore;
  const order = { orderId: "o1", orderDetails: [], cartTotal: 10, orderDate: "2026-10-01T00:00:00Z" as unknown as Date };

  beforeEach(() => {
    actions$ = new Subject<Action>();
    TestBed.configureTestingModule({
      providers: [
        OrderEffects,
        provideMockActions(() => actions$),
        provideMockStore({ selectors: [{ selector: selectAuthenticatedUser, value: aUser() }] }),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    effects = TestBed.inject(OrderEffects);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MockStore);
  });
  afterEach(() => {
    http.verify();
    store.resetSelectors();
  });

  it("loads the signed-in user's orders", () => {
    const out = collect(effects.loadOrders$);
    actions$.next(loadOrders());
    http.expectOne("/api/order").flush([order]);
    expect(out).toEqual([loadOrdersSuccess({ orders: [order] })]);
  });

  it("does not ask for a guest's orders", () => {
    store.overrideSelector(selectAuthenticatedUser, null);
    const out = collect(effects.loadOrders$);
    actions$.next(loadOrders());
    http.expectNone("/api/order");
    expect(out).toEqual([loadOrdersFailure({ errorMessage: "User not found" })]);
  });

  it("reports a failed load in words", () => {
    const out = collect(effects.loadOrders$);
    actions$.next(loadOrders());
    http.expectOne("/api/order").flush({ title: "Server Error" }, { status: 500, statusText: "Server Error" });
    expect(out).toEqual([loadOrdersFailure({ errorMessage: "Server Error" })]);
  });
});
