import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { aBook } from "src/app/testing/fixtures";
import { BookCardComponent } from "./book-card.component";

describe("BookCardComponent", () => {
  let fixture: ComponentFixture<BookCardComponent>;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BookCardComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(BookCardComponent);
    fixture.componentRef.setInput("book", aBook(3, { title: "Dune", price: 250, coverFileName: "dune.png" }));
    fixture.detectChanges();
  });

  it("shows the title, the price in rupees and the cover", () => {
    expect(root().textContent).toContain("Dune");
    expect(root().textContent).toContain("₹250.00");
    expect(root().querySelector("img")?.getAttribute("src")).toBe("/Upload/dune.png");
  });

  it("links to the book's details page", () => {
    const link = root().querySelector("a[href]") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/books/details/3");
  });

  it("reports which book was asked for when the cart button is clicked", () => {
    const added: number[] = [];
    fixture.componentInstance.addToCart.subscribe((id) => added.push(id));
    (root().querySelector("app-addtocart button") as HTMLButtonElement).click();
    expect(added).toEqual([3]);
  });

  it("offers the wishlist heart only to signed-in visitors", () => {
    expect(fixture.debugElement.query(By.css("app-addtowishlist"))).toBeNull();

    fixture.componentRef.setInput("signedIn", true);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css("app-addtowishlist"))).not.toBeNull();
  });

  it("shows the heart ticked for a wishlisted book and reports a click on it", () => {
    const toggles: WishlistToggle[] = [];
    fixture.componentInstance.toggleWishlist.subscribe((t) => toggles.push(t));
    fixture.componentRef.setInput("signedIn", true);
    fixture.componentRef.setInput("wishlisted", true);
    fixture.detectChanges();

    (root().querySelector(".favourite-selected") as HTMLElement).click();

    expect(toggles).toEqual([{ bookId: 3, isAdd: false }]);
  });
});
