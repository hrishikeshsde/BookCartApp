import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { AuthStore } from "src/app/state/auth/auth.store";
import { BooksStore } from "src/app/state/books/books.store";
import { CartStore } from "src/app/state/cart/cart.store";
import { CategoriesStore } from "src/app/state/categories/categories.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
import { fakeBooksStore } from "src/app/testing/fake-books-store";
import { fakeAuthStore, fakeCartStore, fakeWishlistStore } from "src/app/testing/fake-stores";
import { aBook, aUser } from "src/app/testing/fixtures";
import { PriceFilterComponent } from "../price-filter/price-filter.component";
import { HomeComponent } from "./home.component";

const books = [
  aBook(1, { title: "Dune", author: "Frank Herbert", category: "Fiction", price: 300 }),
  aBook(2, { title: "Steve Jobs", author: "Walter Isaacson", category: "Biography", price: 900 }),
  aBook(3, { title: "Emma", author: "Jane Austen", category: "Fiction", price: 150 }),
];

describe("HomeComponent", () => {
  let fixture: ComponentFixture<HomeComponent>;
  let booksStore: ReturnType<typeof fakeBooksStore>;
  let auth: ReturnType<typeof fakeAuthStore>;
  let cart: ReturnType<typeof fakeCartStore>;
  let wishlist: ReturnType<typeof fakeWishlistStore>;
  const categoriesStore = { categories: signal([{ categoryId: 1, categoryName: "Fiction" }]), load: vi.fn() };
  const root = () => fixture.nativeElement as HTMLElement;
  const titles = () =>
    Array.from(root().querySelectorAll("app-book-card .card-title strong")).map((e) => e.textContent?.trim());

  beforeEach(() => {
    booksStore = fakeBooksStore(books);
    auth = fakeAuthStore();
    cart = fakeCartStore();
    wishlist = fakeWishlistStore();
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: auth },
        { provide: CartStore, useValue: cart },
        { provide: WishlistStore, useValue: wishlist },
        { provide: CategoriesStore, useValue: categoriesStore },
        { provide: BooksStore, useValue: booksStore },
      ],
    });
    categoriesStore.load.mockClear();
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });
  it("asks for the books and the categories when the page opens", () => {
    expect(booksStore.load).toHaveBeenCalled();
    expect(categoriesStore.load).toHaveBeenCalled();
  });

  it("shows every book when nothing filters", () => {
    expect(titles()).toEqual(["Dune", "Steve Jobs", "Emma"]);
  });

  it("filters by category, whatever the case of the address", () => {
    fixture.componentRef.setInput("category", "fiction");
    fixture.detectChanges();
    expect(titles()).toEqual(["Dune", "Emma"]);
  });

  it("searches title and author, ignoring case", () => {
    fixture.componentRef.setInput("item", "austen");
    fixture.detectChanges();
    expect(titles()).toEqual(["Emma"]);

    fixture.componentRef.setInput("item", "DUNE");
    fixture.detectChanges();
    expect(titles()).toEqual(["Dune"]);
  });

  it("filters by the price the slider reports, and the filters add up", () => {
    const slider = fixture.debugElement.query(By.directive(PriceFilterComponent)).componentInstance as PriceFilterComponent;
    slider.priceChange.emit(300);
    fixture.detectChanges();
    expect(titles()).toEqual(["Dune", "Emma"]);

    fixture.componentRef.setInput("item", "emma");
    fixture.detectChanges();
    expect(titles()).toEqual(["Emma"]);
  });

  it("says so when nothing matches", () => {
    fixture.componentRef.setInput("item", "no such book");
    fixture.detectChanges();
    expect(root().textContent).toContain("No books found.");
  });

  it("shows a spinner, not 'No books found', while the first load is under way", () => {
    booksStore.entities.set([]);
    booksStore.callState.set("loading");
    fixture.detectChanges();

    expect(root().querySelector("mat-spinner")).not.toBeNull();
    expect(root().textContent).not.toContain("No books found.");
  });

  it("keeps the books on screen while they are being reloaded", () => {
    booksStore.callState.set("loading");
    fixture.detectChanges();

    expect(titles().length).toBe(3);
    expect(root().querySelector("mat-spinner")).toBeNull();
  });

  it("acts on what the cards report: the cart and, for a signed-in visitor, the wishlist", () => {
    auth.user.set(aUser());
    fixture.detectChanges();

    (root().querySelector("app-book-card app-addtocart button") as HTMLButtonElement).click();
    (root().querySelector("app-book-card .favourite-unselected") as HTMLElement).click();

    expect(cart.add).toHaveBeenCalledWith(1);
    expect(wishlist.toggle).toHaveBeenCalledWith({ bookId: 1, isAdd: true });
  });

  it("ticks the heart of the books on the wishlist", () => {
    auth.user.set(aUser());
    wishlist.items.set([books[1]]);
    fixture.detectChanges();

    const hearts = Array.from(root().querySelectorAll("app-book-card")).map((c) => c.querySelector(".favourite-selected") !== null);
    expect(hearts).toEqual([false, true, false]);
  });
});
