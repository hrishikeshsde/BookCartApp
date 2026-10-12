import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { CustomerOrder } from "src/app/models/order";
import { TokenStorage } from "src/app/services/token-storage.service";
import { aCartItem, aToken, inOneHour } from "src/app/testing/fixtures";
import { AuthStore } from "../auth/auth.store";
import { OrdersStore } from "./orders.store";

const url = "/api/order";
const anOrder = (orderId: string): CustomerOrder => ({
  orderId,
  orderDetails: [aCartItem(1, 2)],
  cartTotal: 200,
  orderDate: new Date("2026-10-01T10:00:00Z"),
});

describe("OrdersStore", () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    localStorage.removeItem("authToken");
  });

  const signedInBefore = () => TestBed.inject(TokenStorage).set(aToken({ userId: "7", name: "reader", role: "User", exp: inOneHour() }));

  it("a guest cannot load orders: the store says 'User not found' and sends nothing", () => {
    const store = TestBed.inject(OrdersStore);
    store.load();
    expect(store.error()).toBe("User not found");
    http.expectNone(url);
  });

  it("loads the signed-in user's orders", () => {
    signedInBefore();
    const store = TestBed.inject(OrdersStore);
    store.load();
    expect(store.loading()).toBe(true);

    http.expectOne(url).flush([anOrder("A1"), anOrder("B2")]);

    expect(store.orders().map((order) => order.orderId)).toEqual(["A1", "B2"]);
    expect(store.loaded()).toBe(true);
  });

  it("keeps the reason when the call fails", () => {
    signedInBefore();
    const store = TestBed.inject(OrdersStore);
    store.load();
    http.expectOne(url).flush({ detail: "Database is down" }, { status: 500, statusText: "Server Error" });
    expect(store.error()).toBe("Database is down");
    expect(store.orders()).toEqual([]);
  });

  it("nothing of the user's stays in memory after they log out", () => {
    signedInBefore();
    const store = TestBed.inject(OrdersStore);
    store.load();
    http.expectOne(url).flush([anOrder("A1")]);

    TestBed.inject(AuthStore).logout();
    TestBed.tick();

    expect(store.orders()).toEqual([]);
    expect(store.loaded()).toBe(false);
  });
});
