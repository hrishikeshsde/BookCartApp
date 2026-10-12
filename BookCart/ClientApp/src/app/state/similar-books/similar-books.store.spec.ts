import { signal } from "@angular/core";
import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { aBook } from "src/app/testing/fixtures";
import { SimilarBooksStore } from "./similar-books.store";

const url = (bookId: number) => `/api/book/GetSimilarBooks/${bookId}`;

describe("SimilarBooksStore", () => {
  let store: InstanceType<typeof SimilarBooksStore>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(withXhr()), provideHttpClientTesting()] });
    store = TestBed.inject(SimilarBooksStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it("loads the books similar to the one asked about", () => {
    store.load(4);
    expect(store.loading()).toBe(true);

    http.expectOne(url(4)).flush([aBook(5), aBook(6)]);

    expect(store.books().map((book) => book.bookId)).toEqual([5, 6]);
    expect(store.loaded()).toBe(true);
  });

  it("moving on to another book cancels the request for the previous one", () => {
    store.load(4);
    const first = http.expectOne(url(4));
    store.load(7);
    expect(first.cancelled).toBe(true);

    http.expectOne(url(7)).flush([aBook(8)]);
    expect(store.books().map((book) => book.bookId)).toEqual([8]);
  });

  it("follows a signal: a new value loads again, the same value does not", () => {
    const bookId = signal(4);
    TestBed.runInInjectionContext(() => store.load(bookId));
    TestBed.tick();
    http.expectOne(url(4)).flush([aBook(5)]);

    bookId.set(9);
    TestBed.tick();
    http.expectOne(url(9)).flush([aBook(10)]);
    expect(store.books().map((book) => book.bookId)).toEqual([10]);
  });

  it("keeps the error text when the call fails", () => {
    store.load(4);
    http.expectOne(url(4)).flush({ title: "Not found" }, { status: 404, statusText: "Not Found" });
    expect(store.error()).toBe("Not found");
    expect(store.loading()).toBe(false);
  });
});
