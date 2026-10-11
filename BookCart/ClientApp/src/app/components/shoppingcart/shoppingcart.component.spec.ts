import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { LoadingState } from "src/app/shared/call-state";
import {
  addToCart,
  clearCart,
  loadCart,
  reduceCartQuantity,
  removeCartItem,
} from "src/app/state/actions/cart.actions";
import { selectCartCallState, selectCartItems } from "src/app/state/selectors/cart.selectors";
import { aCartItem } from "src/app/testing/fixtures";
import { ShoppingcartComponent } from "./shoppingcart.component";

describe("ShoppingcartComponent", () => {
  let fixture: ComponentFixture<ShoppingcartComponent>;
  let store: MockStore;
  let dispatch: jasmine.Spy;
  const root = () => fixture.nativeElement as HTMLElement;
  const buttonWithIcon = (icon: string) =>
    Array.from(root().querySelectorAll("button")).find((b) => b.textContent?.trim() === icon) as HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ShoppingcartComponent],
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
    dispatch = spyOn(store, "dispatch");
    fixture = TestBed.createComponent(ShoppingcartComponent);
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("asks the store for the cart when the page opens", () => {
    expect(dispatch).toHaveBeenCalledWith(loadCart());
  });

  it("lists every book with the grand total", () => {
    expect(root().querySelectorAll("table tbody tr").length).toBe(2);
    expect(root().textContent).toContain("Book 1");
    expect(root().textContent).toContain("Book 2");
    expect(root().textContent).toContain("₹400.00"); // 2 x 100 + 1 x 200
  });

  it("its three buttons add one, remove one and remove the book", () => {
    buttonWithIcon("add_circle").click();
    expect(dispatch).toHaveBeenCalledWith(addToCart({ bookId: 1 }));
    buttonWithIcon("remove_circle").click();
    expect(dispatch).toHaveBeenCalledWith(reduceCartQuantity({ bookId: 1 }));
    buttonWithIcon("delete").click();
    expect(dispatch).toHaveBeenCalledWith(removeCartItem({ bookId: 1 }));
  });

  it("clear cart empties it", () => {
    const clear = Array.from(root().querySelectorAll("button")).find((b) => b.textContent?.includes("Clear cart")) as HTMLButtonElement;
    clear.click();
    expect(dispatch).toHaveBeenCalledWith(clearCart());
  });

  it("says so when the cart is empty, and offers no clear button", () => {
    store.overrideSelector(selectCartItems, []);
    store.refreshState();
    fixture.detectChanges();
    expect(root().textContent).toContain("Your shopping cart is empty.");
    expect(root().textContent).not.toContain("Clear cart");
  });
});
