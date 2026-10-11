import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { aBook } from "src/app/testing/fixtures";
import { SimilarbooksComponent } from "./similarbooks.component";

describe("SimilarbooksComponent", () => {
  let fixture: ComponentFixture<SimilarbooksComponent>;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SimilarbooksComponent], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(SimilarbooksComponent);
    fixture.componentRef.setInput("books", [aBook(1), aBook(2)]);
    fixture.detectChanges();
  });

  it("shows a card for each book", () => {
    expect(root().querySelectorAll("app-book-card").length).toBe(2);
    expect(root().querySelector("mat-spinner")).toBeNull();
  });

  it("shows a spinner instead of the cards while the books are being fetched", () => {
    fixture.componentRef.setInput("loading", true);
    fixture.detectChanges();

    expect(root().querySelector("mat-spinner")).not.toBeNull();
    expect(root().querySelectorAll("app-book-card").length).toBe(0);
  });

  it("passes a card's cart and wishlist clicks on to the page", () => {
    const added: number[] = [];
    const toggles: { bookId: number; isAdd: boolean }[] = [];
    fixture.componentInstance.addToCart.subscribe((id) => added.push(id));
    fixture.componentInstance.toggleWishlist.subscribe((t) => toggles.push(t));
    fixture.componentRef.setInput("signedIn", true);
    fixture.componentRef.setInput("wishlistedIds", new Set([2]));
    fixture.detectChanges();

    const cards = root().querySelectorAll("app-book-card");
    (cards[1].querySelector("app-addtocart button") as HTMLButtonElement).click();
    (cards[1].querySelector(".favourite-selected") as HTMLElement).click(); // book 2 is on the wishlist

    expect(added).toEqual([2]);
    expect(toggles).toEqual([{ bookId: 2, isAdd: false }]);
  });
});
