import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { AuthStore } from "src/app/state/auth/auth.store";
import { BooksStore } from "src/app/state/books/books.store";
import { CartStore } from "src/app/state/cart/cart.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
import { fakeBooksStore } from "src/app/testing/fake-books-store";
import { fakeAuthStore, fakeCartStore, fakeWishlistStore } from "src/app/testing/fake-stores";
import { aBook, aCartItem, aUser } from "src/app/testing/fixtures";
import { SearchComponent } from "../search/search.component";
import { NavBarComponent } from "./nav-bar.component";

describe("NavBarComponent", () => {
  let fixture: ComponentFixture<NavBarComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let auth: ReturnType<typeof fakeAuthStore>;
  let cart: ReturnType<typeof fakeCartStore>;
  let wishlist: ReturnType<typeof fakeWishlistStore>;
  const root = () => fixture.nativeElement as HTMLElement;
  const search = () => fixture.debugElement.query((el) => el.componentInstance instanceof SearchComponent).componentInstance as SearchComponent;
  const badges = () => Array.from(root().querySelectorAll(".mat-badge-content")).map((badge) => badge.textContent?.trim());

  beforeEach(() => {
    auth = fakeAuthStore();
    cart = fakeCartStore();
    wishlist = fakeWishlistStore();
    TestBed.configureTestingModule({
      imports: [NavBarComponent],
      providers: [
        provideRouter([{ path: "search", children: [] }, { path: "filter", children: [] }]),
        { provide: BooksStore, useValue: fakeBooksStore([aBook(1, { title: "Dune" })]) },
        { provide: AuthStore, useValue: auth },
        { provide: CartStore, useValue: cart },
        { provide: WishlistStore, useValue: wishlist },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    fixture = TestBed.createComponent(NavBarComponent);
    fixture.detectChanges();
  });

  describe("the search box", () => {
    it("gives the search box the books to suggest", () => {
      expect(search().books().map((book) => book.title)).toEqual(["Dune"]);
    });

    it("shows what the search page is searching for, and nothing on any other page", async () => {
      const router = TestBed.inject(Router);
      await router.navigateByUrl("/search?item=dune");
      fixture.detectChanges();
      await fixture.whenStable();
      expect(search().searchControl.value).toBe("dune");

      await router.navigateByUrl("/");
      fixture.detectChanges();
      await fixture.whenStable();
      expect(search().searchControl.value).toBe("");

      // an ?item= on a page that is not the search page is not a search
      await router.navigateByUrl("/filter?item=dune");
      fixture.detectChanges();
      await fixture.whenStable();
      expect(search().searchControl.value).toBe("");
    });

    it("opens the search results page for a search", () => {
      search().searched.emit("emma");
      expect(navigate).toHaveBeenCalledWith(["/search"], { queryParams: { item: "emma" } });
    });

    it("goes back to the full list when the search is cleared", () => {
      search().cleared.emit();
      expect(navigate).toHaveBeenCalledWith(["/"]);
    });

    it("is not fooled by the browser's own bubbling 'search' event from the inner box (it once searched for \"[object Event]\")", () => {
      const box = root().querySelector("input.searchbox") as HTMLInputElement;
      box.value = "Dune";
      box.dispatchEvent(new Event("input"));
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      box.dispatchEvent(new Event("search", { bubbles: true }));

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(["/search"], { queryParams: { item: "dune" } });
    });
  });

  describe("the account area", () => {
    it("offers Login to a guest, and no wishlist, admin panel or account menu", () => {
      expect(root().textContent).toContain("Login");
      expect(root().textContent).not.toContain("Admin Panel");
      expect(root().querySelector("mat-icon[matbadge]")).toBeNull();
      expect(root().textContent).not.toContain("favorite");
    });

    it("shows a signed-in user's name, and the wishlist", () => {
      auth.user.set(aUser({ username: "reader" }));
      fixture.detectChanges();
      expect(root().textContent).toContain("reader");
      expect(root().textContent).not.toContain("Login");
      expect(root().textContent).toContain("favorite");
    });

    it("offers the admin panel to an admin only", () => {
      auth.user.set(aUser({ userTypeName: "User" }));
      fixture.detectChanges();
      expect(root().textContent).not.toContain("Admin Panel");

      auth.user.set(aUser({ userTypeName: "Admin" }));
      fixture.detectChanges();
      expect(root().textContent).toContain("Admin Panel");
    });

    it("badges count the copies in the cart and the books on the wishlist", () => {
      auth.user.set(aUser());
      cart.items.set([aCartItem(1, 2), aCartItem(2, 3)]);
      wishlist.items.set([aBook(1), aBook(2)]);
      fixture.detectChanges();
      expect(badges()).toEqual(["2", "5"]); // wishlist first, then cart
    });

    it("logs out through the store", () => {
      fixture.componentInstance.logout();
      expect(auth.logout).toHaveBeenCalledTimes(1);
    });
  });
});

describe("NavBarComponent narrow and wide layouts", () => {
  let fixture: ComponentFixture<NavBarComponent>;
  let auth: ReturnType<typeof fakeAuthStore>;
  let cart: ReturnType<typeof fakeCartStore>;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    auth = fakeAuthStore();
    cart = fakeCartStore();
    TestBed.configureTestingModule({
      imports: [NavBarComponent],
      providers: [
        provideRouter([]),
        { provide: BooksStore, useValue: fakeBooksStore([]) },
        { provide: AuthStore, useValue: auth },
        { provide: CartStore, useValue: cart },
        { provide: WishlistStore, useValue: fakeWishlistStore() },
      ],
    });
    fixture = TestBed.createComponent(NavBarComponent);
    fixture.detectChanges();
  });

  // Which of them shows is decided by a CSS media query (so the page drawn in advance is right at any width, and nothing
  // jumps when the app takes it over); a unit test sees both in the page.
  it("has one search box, placed by CSS, and both the wide links and the narrow menu button", () => {
    expect(root().querySelectorAll("app-search").length).toBe(1);
    expect(root().querySelector(".wide-links")).not.toBeNull();
    expect(root().querySelector('button.narrow-menu[aria-label="Menu"]')).not.toBeNull();
  });

  it("the menu offers Login and Register to a guest", () => {
    (root().querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(document.querySelectorAll(".mat-mdc-menu-item")).map((i) => i.textContent?.trim());
    expect(items).toContain("Login");
    expect(items).toContain("Register");
    expect(items).not.toContain("Logout");
  });

  it("the menu offers My Orders and Logout to a signed-in user, and Admin Panel only to an admin", () => {
    auth.user.set(aUser({ userTypeName: "Admin" }));
    fixture.detectChanges();
    (root().querySelector('button[aria-label="Menu"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(document.querySelectorAll(".mat-mdc-menu-item")).map((i) => i.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(["My Orders", "Admin Panel", "Logout"]));
  });

  it("the cart icon has a name that says how many items are in it", () => {
    cart.items.set([aCartItem(1, 2), aCartItem(2, 3)]);
    fixture.detectChanges();
    expect(root().querySelector('a[aria-label^="Shopping cart"]')?.getAttribute("aria-label")).toBe("Shopping cart, 5 items");
  });
});
