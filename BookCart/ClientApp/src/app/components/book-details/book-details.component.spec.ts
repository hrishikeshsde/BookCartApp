import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { Subject } from "rxjs";
import { BookService } from "src/app/services/book.service";
import { Book } from "src/app/models/book";
import { AuthStore } from "src/app/state/auth/auth.store";
import { BooksStore } from "src/app/state/books/books.store";
import { CartStore } from "src/app/state/cart/cart.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
import { fakeBooksStore } from "src/app/testing/fake-books-store";
import { fakeAuthStore, fakeCartStore, fakeWishlistStore } from "src/app/testing/fake-stores";
import { aBook, aUser } from "src/app/testing/fixtures";
import { BookDetailsComponent } from "./book-details.component";

describe("BookDetailsComponent", () => {
  let fixture: ComponentFixture<BookDetailsComponent>;
  let booksStore: ReturnType<typeof fakeBooksStore>;
  let auth: ReturnType<typeof fakeAuthStore>;
  let cart: ReturnType<typeof fakeCartStore>;
  let wishlist: ReturnType<typeof fakeWishlistStore>;
  let summaryRequests: { bookId: number; answer: Subject<{ summary: string }> }[];
  let similarRequests: { bookId: number; answer: Subject<Book[]> }[];
  const root = () => fixture.nativeElement as HTMLElement;
  const generateButton = () => root().querySelector("app-book-summary button") as HTMLButtonElement;

  beforeEach(() => {
    summaryRequests = [];
    similarRequests = [];
    auth = fakeAuthStore();
    cart = fakeCartStore();
    wishlist = fakeWishlistStore();
    booksStore = fakeBooksStore([aBook(1, { title: "Dune" }), aBook(2, { title: "Emma" })]);
    TestBed.configureTestingModule({
      imports: [BookDetailsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: auth },
        { provide: CartStore, useValue: cart },
        { provide: WishlistStore, useValue: wishlist },
        { provide: BooksStore, useValue: booksStore },
        {
          provide: BookService,
          useValue: {
            getSimilarBooks: (bookId: number) => {
              const answer = new Subject<Book[]>();
              similarRequests.push({ bookId, answer });
              return answer;
            },
            getBookSummary: (bookId: number) => {
              const answer = new Subject<{ summary: string }>();
              summaryRequests.push({ bookId, answer });
              return answer;
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(BookDetailsComponent);
    fixture.componentRef.setInput("id", "1");
    fixture.detectChanges();
  });

  it("shows the book the address names", () => {
    expect(root().textContent).toContain("Dune");
    expect(root().textContent).not.toContain("Emma");
  });

  it("fetches the similar books of that book, and again when the page moves to another", () => {
    expect(similarRequests.map((r) => r.bookId)).toEqual([1]);

    fixture.componentRef.setInput("id", "2");
    fixture.detectChanges();

    expect(similarRequests.map((r) => r.bookId)).toEqual([1, 2]);
    expect(root().textContent).toContain("Emma");
  });

  it("lists the similar books it was given", () => {
    similarRequests[0].answer.next([aBook(2), aBook(3)]);
    fixture.detectChanges();
    expect(root().querySelectorAll("app-similarbooks app-book-card").length).toBe(2);
  });

  it("puts the book in the cart when asked", () => {
    (root().querySelector("app-addtocart button") as HTMLButtonElement).click();
    expect(cart.add).toHaveBeenCalledWith(1);
  });

  it("offers the wishlist only to a signed-in visitor, and reports a click", () => {
    expect(root().querySelector("app-addtowishlist")).toBeNull();

    auth.user.set(aUser());
    fixture.detectChanges();
    (root().querySelector("app-addtowishlist button") as HTMLButtonElement).click();

    expect(wishlist.toggle).toHaveBeenCalledWith({ bookId: 1, isAdd: true });
  });

  it("knows the book is on the wishlist", () => {
    auth.user.set(aUser());
    wishlist.items.set([aBook(1)]);
    fixture.detectChanges();
    expect(root().querySelector("app-addtowishlist button")?.textContent).toContain("Remove from Wishlist");
  });

  describe("the AI summary", () => {
    it("asks the server for this book's summary, shows a spinner while it waits, then the text", () => {
      generateButton().click();
      fixture.detectChanges();
      expect(summaryRequests.map((r) => r.bookId)).toEqual([1]);
      expect(root().querySelector("app-book-summary mat-spinner")).not.toBeNull();

      summaryRequests[0].answer.next({ summary: "A desert planet." });
      summaryRequests[0].answer.complete();
      fixture.detectChanges();

      expect(root().querySelector("app-book-summary mat-spinner")).toBeNull();
      expect(root().querySelector("app-book-summary")?.textContent).toContain("A desert planet.");
    });

    it("says it could not be generated when the server fails", () => {
      generateButton().click();
      summaryRequests[0].answer.error(new Error("503"));
      fixture.detectChanges();

      expect(root().querySelector("app-book-summary")?.textContent).toContain("could not be generated");
      expect(root().querySelector("app-book-summary mat-spinner")).toBeNull();
    });

    it("forgets the summary when the page moves to another book", () => {
      generateButton().click();
      summaryRequests[0].answer.next({ summary: "A desert planet." });
      summaryRequests[0].answer.complete();
      fixture.detectChanges();
      expect(root().querySelector("app-book-summary")?.textContent).toContain("A desert planet.");

      fixture.componentRef.setInput("id", "2");
      fixture.detectChanges();

      expect(root().querySelector("app-book-summary")?.textContent).not.toContain("A desert planet.");
    });

    it("drops an answer that arrives after the page has moved to another book", () => {
      generateButton().click();
      fixture.componentRef.setInput("id", "2");
      fixture.detectChanges();

      summaryRequests[0].answer.next({ summary: "A desert planet." });
      summaryRequests[0].answer.complete();
      fixture.detectChanges();

      expect(root().querySelector("app-book-summary")?.textContent).not.toContain("A desert planet.");
    });
  });
});
