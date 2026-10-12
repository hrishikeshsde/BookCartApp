import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { Subject } from "rxjs";
import { CheckoutService } from "src/app/services/checkout.service";
import { SnackbarService } from "src/app/services/snackbar.service";
import { CartStore } from "src/app/state/cart/cart.store";
import { fakeCartStore } from "src/app/testing/fake-stores";
import { aCartItem } from "src/app/testing/fixtures";
import { SnackbarStub } from "src/app/testing/helpers";
import { CheckoutComponent } from "./checkout.component";

const address = { name: "Reader", addressLine1: "1 Road", addressLine2: "Area", pincode: "560001", state: "Karnataka" };

describe("CheckoutComponent", () => {
  let fixture: ComponentFixture<CheckoutComponent>;
  let component: CheckoutComponent;
  let cart: ReturnType<typeof fakeCartStore>;
  let snackbar: SnackbarStub;
  let navigate: ReturnType<typeof vi.spyOn>;
  let orders: Subject<{ orderId: string }>[];
  const placeOrderCall = vi.fn();
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    cart = fakeCartStore([aCartItem(1, 2), aCartItem(2, 1)]);
    snackbar = new SnackbarStub();
    orders = [];
    placeOrderCall.mockReset();
    placeOrderCall.mockImplementation(() => {
      const answer = new Subject<{ orderId: string }>();
      orders.push(answer);
      return answer;
    });
    TestBed.configureTestingModule({
      imports: [CheckoutComponent],
      providers: [
        provideRouter([]),
        { provide: CartStore, useValue: cart },
        { provide: CheckoutService, useValue: { placeOrder: placeOrderCall } },
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    fixture = TestBed.createComponent(CheckoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  it("shows the total of the cart (copies times price)", () => {
    expect(component.totalPrice()).toBe(2 * 100 + 1 * 200);
    expect(root().textContent).toContain("₹400.00");
  });

  it("will not place an order from an incomplete form", () => {
    component.checkOutForm.patchValue({ ...address, name: "" });
    component.placeOrder();
    expect(placeOrderCall).not.toHaveBeenCalled();
  });

  for (const pincode of ["012345", "56001", "5600011", "abcdef"]) {
    it(`rejects the pincode ${pincode}`, () => {
      component.checkOutForm.setValue({ ...address, pincode });
      expect(component.checkOutForm.controls.pincode.valid).toBe(false);
    });
  }

  it("places the order with no payload when the form is complete (the server prices it)", () => {
    component.checkOutForm.setValue(address);
    component.placeOrder();
    expect(placeOrderCall).toHaveBeenCalledTimes(1);
    expect(placeOrderCall).toHaveBeenCalledWith();
  });

  it("ignores a second submit while the order is being placed", () => {
    component.checkOutForm.setValue(address);
    component.placeOrder();
    component.placeOrder();
    expect(placeOrderCall).toHaveBeenCalledTimes(1);
  });

  it("after the order: says so, goes to My Orders and reloads the (now empty) cart", () => {
    component.checkOutForm.setValue(address);
    component.placeOrder();
    orders[0].next({ orderId: "A1" });
    orders[0].complete();

    expect(snackbar.messages).toEqual(["Order placed successfully!!!"]);
    expect(navigate).toHaveBeenCalledWith(["/myorders"]);
    expect(cart.load).toHaveBeenCalledTimes(1);
  });

  it("when the server refuses: says so, stays on the page, reloads the cart and allows another try", () => {
    component.checkOutForm.setValue(address);
    component.placeOrder();
    orders[0].error(new Error("409"));

    expect(snackbar.messages[0]).toContain("The order could not be placed");
    expect(navigate).not.toHaveBeenCalled();
    expect(cart.load).toHaveBeenCalledTimes(1);

    component.placeOrder();
    expect(placeOrderCall).toHaveBeenCalledTimes(2);
  });

  it("locks the form when the loaded cart turns out to be empty", () => {
    cart.items.set([]);
    fixture.detectChanges();
    expect(component.checkOutForm.disabled).toBe(true);
  });
});
