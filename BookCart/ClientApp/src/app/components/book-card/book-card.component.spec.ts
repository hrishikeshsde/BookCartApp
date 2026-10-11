import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { addToCart } from "src/app/state/actions/cart.actions";
import { selectIsAuthenticated } from "src/app/state/selectors/auth.selectors";
import { selectWishlistItems } from "src/app/state/selectors/wishlist.selectors";
import { aBook } from "src/app/testing/fixtures";
import { BookCardComponent } from "./book-card.component";

describe("BookCardComponent", () => {
  let fixture: ComponentFixture<BookCardComponent>;
  let store: MockStore;
  const element = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BookCardComponent],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectIsAuthenticated, value: false },
            { selector: selectWishlistItems, value: [] },
          ],
        }),
      ],
    });
    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(BookCardComponent);
    fixture.componentRef.setInput("book", aBook(3, { title: "Dune", price: 250, coverFileName: "dune.png" }));
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("shows the title, the price in rupees and the cover", () => {
    expect(element().textContent).toContain("Dune");
    expect(element().textContent).toContain("₹250.00");
    expect(element().querySelector("img")?.getAttribute("src")).toBe("/Upload/dune.png");
  });

  it("links to the book's details page", () => {
    const link = element().querySelector("a[href]") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/books/details/3");
  });

  it("adding to the cart asks the store to add this book", () => {
    spyOn(store, "dispatch");
    (element().querySelector("app-addtocart button") as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledOnceWith(addToCart({ bookId: 3 }));
  });

  it("offers the wishlist heart only to signed-in visitors", () => {
    expect(fixture.debugElement.query(By.css("app-addtowishlist"))).toBeNull();

    store.overrideSelector(selectIsAuthenticated, true);
    store.refreshState();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css("app-addtowishlist"))).not.toBeNull();
  });
});
