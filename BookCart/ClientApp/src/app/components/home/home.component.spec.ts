import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { LoadingState } from "src/app/shared/call-state";
import { loadBooks, resetSearchItemValue, setSearchItemValue } from "src/app/state/actions/book.actions";
import { addToCart } from "src/app/state/actions/cart.actions";
import { loadCategories } from "src/app/state/actions/categories.actions";
import { toggleWishlistItem } from "src/app/state/actions/wishlist.actions";
import { selectIsAuthenticated } from "src/app/state/selectors/auth.selectors";
import {
  selectBookCallState,
  selectBooks,
  selectMaxBookPrice,
  selectMinBookPrice,
} from "src/app/state/selectors/book.selectors";
import { selectCategories } from "src/app/state/selectors/categories.selectors";
import { selectWishlistItems } from "src/app/state/selectors/wishlist.selectors";
import { aBook } from "src/app/testing/fixtures";
import { PriceFilterComponent } from "../price-filter/price-filter.component";
import { HomeComponent } from "./home.component";

const books = [
  aBook(1, { title: "Dune", author: "Frank Herbert", category: "Fiction", price: 300 }),
  aBook(2, { title: "Steve Jobs", author: "Walter Isaacson", category: "Biography", price: 900 }),
  aBook(3, { title: "Emma", author: "Jane Austen", category: "Fiction", price: 150 }),
];

describe("HomeComponent", () => {
  let fixture: ComponentFixture<HomeComponent>;
  let store: MockStore;
  const root = () => fixture.nativeElement as HTMLElement;
  const titles = () =>
    Array.from(root().querySelectorAll("app-book-card .card-title strong")).map((e) => e.textContent?.trim());

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectBooks, value: books },
            { selector: selectBookCallState, value: LoadingState.LOADED },
            { selector: selectMinBookPrice, value: 150 },
            { selector: selectMaxBookPrice, value: 900 },
            { selector: selectCategories, value: [{ categoryId: 1, categoryName: "Fiction" }] },
            { selector: selectIsAuthenticated, value: false },
            { selector: selectWishlistItems, value: [] },
          ],
        }),
      ],
    });
    store = TestBed.inject(MockStore);
    vi.spyOn(store, "dispatch");
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("asks for the books and the categories when the page opens", () => {
    expect(store.dispatch).toHaveBeenCalledWith(loadBooks());
    expect(store.dispatch).toHaveBeenCalledWith(loadCategories());
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
    store.overrideSelector(selectBooks, []);
    store.overrideSelector(selectBookCallState, LoadingState.LOADING);
    store.refreshState();
    fixture.detectChanges();

    expect(root().querySelector("mat-spinner")).not.toBeNull();
    expect(root().textContent).not.toContain("No books found.");
  });

  it("keeps the books on screen while they are being reloaded", () => {
    store.overrideSelector(selectBookCallState, LoadingState.LOADING);
    store.refreshState();
    fixture.detectChanges();

    expect(titles().length).toBe(3);
    expect(root().querySelector("mat-spinner")).toBeNull();
  });

  it("holds the search text in the store for the search box, and forgets it on the way out", () => {
    fixture.componentRef.setInput("item", "dune");
    fixture.detectChanges();
    expect(store.dispatch).toHaveBeenCalledWith(setSearchItemValue({ searchItem: "dune" }));

    fixture.destroy();
    expect(store.dispatch).toHaveBeenCalledWith(resetSearchItemValue());
  });

  it("acts on what the cards report: the cart and, for a signed-in visitor, the wishlist", () => {
    store.overrideSelector(selectIsAuthenticated, true);
    store.refreshState();
    fixture.detectChanges();

    (root().querySelector("app-book-card app-addtocart button") as HTMLButtonElement).click();
    (root().querySelector("app-book-card .favourite-unselected") as HTMLElement).click();

    expect(store.dispatch).toHaveBeenCalledWith(addToCart({ bookId: 1 }));
    expect(store.dispatch).toHaveBeenCalledWith(toggleWishlistItem({ bookId: 1, isAdd: true }));
  });

  it("ticks the heart of the books on the wishlist", () => {
    store.overrideSelector(selectIsAuthenticated, true);
    store.overrideSelector(selectWishlistItems, [books[1]]);
    store.refreshState();
    fixture.detectChanges();

    const hearts = Array.from(root().querySelectorAll("app-book-card")).map((c) => c.querySelector(".favourite-selected") !== null);
    expect(hearts).toEqual([false, true, false]);
  });
});
