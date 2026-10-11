import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { LoadingState } from "src/app/shared/call-state";
import { placeOrder } from "src/app/state/actions/checkout.actions";
import { selectCartCallState, selectCartItems } from "src/app/state/selectors/cart.selectors";
import { aCartItem } from "src/app/testing/fixtures";
import { CheckoutComponent } from "./checkout.component";

const address = { name: "Reader", addressLine1: "1 Road", addressLine2: "Area", pincode: "560001", state: "Karnataka" };

describe("CheckoutComponent", () => {
  let fixture: ComponentFixture<CheckoutComponent>;
  let component: CheckoutComponent;
  let store: MockStore;
  let dispatch: Mock;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CheckoutComponent],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectCartItems, value: [aCartItem(1, 2), aCartItem(2, 1)] },
            { selector: selectCartCallState, value: LoadingState.LOADED },
          ],
        }),
      ],
    });
    store = TestBed.inject(MockStore);
    dispatch = vi.spyOn(store, "dispatch");
    fixture = TestBed.createComponent(CheckoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("shows the total of the cart (copies times price)", () => {
    expect(component.totalPrice).toBe(2 * 100 + 1 * 200);
    expect(root().textContent).toContain("₹400.00");
  });

  it("will not place an order from an incomplete form", () => {
    component.checkOutForm.patchValue({ ...address, name: "" });
    component.placeOrder();
    expect(dispatch).not.toHaveBeenCalled();
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
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(placeOrder());
  });

  it("locks the form when the loaded cart turns out to be empty", () => {
    store.overrideSelector(selectCartItems, []);
    store.refreshState();
    fixture.detectChanges();
    expect(component.checkOutForm.disabled).toBe(true);
  });
});
