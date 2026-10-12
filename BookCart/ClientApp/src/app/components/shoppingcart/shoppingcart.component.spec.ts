import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { CartStore } from "src/app/state/cart/cart.store";
import { fakeCartStore } from "src/app/testing/fake-stores";
import { aCartItem } from "src/app/testing/fixtures";
import { ShoppingcartComponent } from "./shoppingcart.component";

describe("ShoppingcartComponent", () => {
  let fixture: ComponentFixture<ShoppingcartComponent>;
  let cart: ReturnType<typeof fakeCartStore>;
  const root = () => fixture.nativeElement as HTMLElement;
  const buttonWithIcon = (icon: string) => Array.from(root().querySelectorAll("button")).find((b) => b.textContent?.trim() === icon) as HTMLButtonElement;

  beforeEach(() => {
    cart = fakeCartStore([aCartItem(1, 2), aCartItem(2, 1)]);
    TestBed.configureTestingModule({
      imports: [ShoppingcartComponent],
      providers: [provideRouter([]), { provide: CartStore, useValue: cart }],
    });
    fixture = TestBed.createComponent(ShoppingcartComponent);
    fixture.detectChanges();
  });

  it("asks the store for the cart when the page opens", () => {
    expect(cart.load).toHaveBeenCalledTimes(1);
  });

  it("lists every book with the grand total", () => {
    expect(root().querySelectorAll("table tbody tr").length).toBe(2);
    expect(root().textContent).toContain("Book 1");
    expect(root().textContent).toContain("Book 2");
    expect(root().textContent).toContain("₹400.00"); // 2 x 100 + 1 x 200
  });

  it("its three buttons add one, remove one and remove the book", () => {
    buttonWithIcon("add_circle").click();
    expect(cart.add).toHaveBeenCalledWith(1);
    buttonWithIcon("remove_circle").click();
    expect(cart.reduce).toHaveBeenCalledWith(1);
    buttonWithIcon("delete").click();
    expect(cart.remove).toHaveBeenCalledWith(1);
  });

  it("clear cart empties it", () => {
    const clear = Array.from(root().querySelectorAll("button")).find((b) => b.textContent?.includes("Clear cart")) as HTMLButtonElement;
    clear.click();
    expect(cart.clear).toHaveBeenCalled();
  });

  it("says so when the cart is empty, and offers no clear button", () => {
    cart.items.set([]);
    fixture.detectChanges();
    expect(root().textContent).toContain("Your shopping cart is empty.");
    expect(root().textContent).not.toContain("Clear cart");
  });

  it("shows a spinner, not 'empty', while the cart is loading", () => {
    cart.items.set([]);
    cart.callState.set("loading");
    fixture.detectChanges();
    expect(root().querySelector("mat-spinner")).not.toBeNull();
    expect(root().textContent).not.toContain("Your shopping cart is empty.");
  });
});
