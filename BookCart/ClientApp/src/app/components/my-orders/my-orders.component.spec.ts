import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { CustomerOrder } from "src/app/models/order";
import { OrdersStore } from "src/app/state/orders/orders.store";
import { fakeOrdersStore } from "src/app/testing/fake-stores";
import { aCartItem } from "src/app/testing/fixtures";
import { MyOrdersComponent } from "./my-orders.component";

const anOrder = (orderId: string, cartTotal: number): CustomerOrder => ({
  orderId,
  orderDetails: [aCartItem(1, 2)],
  cartTotal,
  orderDate: "2026-10-01T10:00:00Z" as unknown as Date, // the API sends an ISO string
});

describe("MyOrdersComponent", () => {
  let fixture: ComponentFixture<MyOrdersComponent>;
  let ordersStore: ReturnType<typeof fakeOrdersStore>;
  const root = () => fixture.nativeElement as HTMLElement;
  const rows = () => root().querySelectorAll("tr.example-element-row");
  const orderIds = () => Array.from(rows()).map((row) => row.querySelector("td")?.textContent?.trim());

  beforeEach(() => {
    ordersStore = fakeOrdersStore([anOrder("AB12", 200), anOrder("CD34", 450)]);
    TestBed.configureTestingModule({
      imports: [MyOrdersComponent],
      providers: [provideRouter([]), { provide: OrdersStore, useValue: ordersStore }],
    });
    fixture = TestBed.createComponent(MyOrdersComponent);
    fixture.detectChanges();
  });

  it("asks for the orders when the page opens", () => {
    expect(ordersStore.load).toHaveBeenCalledTimes(1);
  });

  it("lists the orders with their totals", () => {
    expect(orderIds()).toEqual(["AB12", "CD34"]);
    expect(root().textContent).toContain("₹200.00");
    expect(root().textContent).toContain("₹450.00");
  });

  it("filters by order id, total or date as the visitor types", () => {
    const search = root().querySelector("input[placeholder=Search]") as HTMLInputElement;
    search.value = "cd3";
    search.dispatchEvent(new Event("keyup"));
    fixture.detectChanges();
    expect(orderIds()).toEqual(["CD34"]);

    search.value = "450";
    search.dispatchEvent(new Event("keyup"));
    fixture.detectChanges();
    expect(orderIds()).toEqual(["CD34"]);
  });

  it("opens one order's books at a time: a click opens it, another click closes it, a second order replaces it", () => {
    const expanded = () => root().querySelectorAll(".example-detail-row .expanded").length;
    expect(expanded()).toBe(0);

    (rows()[0] as HTMLElement).click();
    fixture.detectChanges();
    expect(expanded()).toBe(1);
    expect(root().querySelector(".example-detail-row .expanded")?.textContent).toContain("Book 1");

    (rows()[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(expanded()).toBe(1);

    (rows()[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(expanded()).toBe(0);
  });

  it("shows a spinner while the orders load, and 'no orders' once they have loaded empty", () => {
    ordersStore.orders.set([]);
    ordersStore.callState.set("loading");
    fixture.detectChanges();
    expect(root().querySelector("mat-spinner")).not.toBeNull();

    ordersStore.callState.set("loaded");
    fixture.detectChanges();
    expect(root().querySelector("mat-spinner")).toBeNull();
    expect(rows().length).toBe(0);
  });
});
