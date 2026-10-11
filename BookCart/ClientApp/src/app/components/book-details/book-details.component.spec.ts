import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { provideStore, Store } from "@ngrx/store";
import { Subject } from "rxjs";
import { BookService } from "src/app/services/book.service";
import { setAuthState } from "src/app/state/actions/auth.actions";
import { loadBooksSuccess } from "src/app/state/actions/book.actions";
import { addToCart } from "src/app/state/actions/cart.actions";
import { loadSimilarBooks, loadSimilarBooksSuccess } from "src/app/state/actions/similar-books.actions";
import { toggleWishlistItem } from "src/app/state/actions/wishlist.actions";
import { loadWishlistSuccess } from "src/app/state/actions/wishlist.actions";
import { AUTH_FEATURE_KEY, authReducer } from "src/app/state/reducers/auth.reducers";
import { BOOK_FEATURE_KEY, bookReducer } from "src/app/state/reducers/book.reducers";
import { SIMILAR_BOOKS_FEATURE_KEY, similarBooksReducer } from "src/app/state/reducers/similar-books.reducers";
import { WISHLIST_FEATURE_KEY, wishlistReducer } from "src/app/state/reducers/wishlist.reducers";
import { aBook, aUser } from "src/app/testing/fixtures";
import { BookDetailsComponent } from "./book-details.component";

describe("BookDetailsComponent", () => {
  let fixture: ComponentFixture<BookDetailsComponent>;
  let store: Store;
  let dispatch: ReturnType<typeof vi.spyOn>;
  let summaryRequests: { bookId: number; answer: Subject<{ summary: string }> }[];
  const root = () => fixture.nativeElement as HTMLElement;
  const generateButton = () => root().querySelector("app-book-summary button") as HTMLButtonElement;

  beforeEach(() => {
    summaryRequests = [];
    TestBed.configureTestingModule({
      imports: [BookDetailsComponent],
      providers: [
        provideRouter([]),
        provideStore({
          [BOOK_FEATURE_KEY]: bookReducer,
          [AUTH_FEATURE_KEY]: authReducer,
          [WISHLIST_FEATURE_KEY]: wishlistReducer,
          [SIMILAR_BOOKS_FEATURE_KEY]: similarBooksReducer,
        }),
        {
          provide: BookService,
          useValue: {
            getBookSummary: (bookId: number) => {
              const answer = new Subject<{ summary: string }>();
              summaryRequests.push({ bookId, answer });
              return answer;
            },
          },
        },
      ],
    });
    store = TestBed.inject(Store);
    dispatch = vi.spyOn(store, "dispatch");
    fixture = TestBed.createComponent(BookDetailsComponent);
    // The page asks for the books when it opens; the server's answer (no effects run in this spec) is played here.
    store.dispatch(loadBooksSuccess({ books: [aBook(1, { title: "Dune" }), aBook(2, { title: "Emma" })] }));
    fixture.componentRef.setInput("id", "1");
    fixture.detectChanges();
  });

  it("shows the book the address names", () => {
    expect(root().textContent).toContain("Dune");
    expect(root().textContent).not.toContain("Emma");
  });

  it("fetches the similar books of that book, and again when the page moves to another", () => {
    expect(dispatch).toHaveBeenCalledWith(loadSimilarBooks({ bookId: 1 }));

    fixture.componentRef.setInput("id", "2");
    fixture.detectChanges();

    expect(dispatch).toHaveBeenCalledWith(loadSimilarBooks({ bookId: 2 }));
    expect(root().textContent).toContain("Emma");
  });

  it("lists the similar books it was given", () => {
    store.dispatch(loadSimilarBooksSuccess({ books: [aBook(2), aBook(3)] }));
    fixture.detectChanges();
    expect(root().querySelectorAll("app-similarbooks app-book-card").length).toBe(2);
  });

  it("puts the book in the cart when asked", () => {
    (root().querySelector("app-addtocart button") as HTMLButtonElement).click();
    expect(dispatch).toHaveBeenCalledWith(addToCart({ bookId: 1 }));
  });

  it("offers the wishlist only to a signed-in visitor, and reports a click", () => {
    expect(root().querySelector("app-addtowishlist")).toBeNull();

    store.dispatch(setAuthState({ user: aUser() }));
    fixture.detectChanges();
    (root().querySelector("app-addtowishlist button") as HTMLButtonElement).click();

    expect(dispatch).toHaveBeenCalledWith(toggleWishlistItem({ bookId: 1, isAdd: true }));
  });

  it("knows the book is on the wishlist", () => {
    store.dispatch(setAuthState({ user: aUser() }));
    store.dispatch(loadWishlistSuccess({ wishlist: [aBook(1)] }));
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
