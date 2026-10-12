import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { SnackbarService } from "src/app/services/snackbar.service";
import { aBook } from "src/app/testing/fixtures";
import { SnackbarStub } from "src/app/testing/helpers";
import { BooksStore } from "./books.store";

const url = "/api/book";

describe("BooksStore", () => {
  let store: InstanceType<typeof BooksStore>;
  let http: HttpTestingController;
  let snackbar: SnackbarStub;
  let navigate: ReturnType<typeof vi.spyOn>;
  const ids = () => store.entities().map((book) => book.bookId);

  beforeEach(() => {
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    store = TestBed.inject(BooksStore);
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => http.verify());

  /** Loads three books: 1 (price 100), 2 (200), 3 (300). */
  const loadThree = () => {
    store.load();
    http.expectOne(url).flush([aBook(1), aBook(2), aBook(3)]);
  };

  describe("loading", () => {
    it("loads the books, showing that it is loading meanwhile", () => {
      store.load();
      expect(store.loading()).toBe(true);
      http.expectOne(url).flush([aBook(1), aBook(2)]);
      expect(ids()).toEqual([1, 2]);
      expect(store.loaded()).toBe(true);
    });

    it("fetches once: later loads, from any page, send nothing", () => {
      loadThree();
      store.load();
      http.expectNone(url);
    });

    it("a load while one is under way does not send a second request", () => {
      store.load();
      store.load();
      http.expectOne(url).flush([]);
    });

    it("keeps the error text on failure and tries again on the next load", () => {
      store.load();
      http.expectOne(url).flush({ detail: "Database is down" }, { status: 500, statusText: "Server Error" });
      expect(store.error()).toBe("Database is down");

      loadThree();
      expect(store.error()).toBeNull();
      expect(ids()).toEqual([1, 2, 3]);
    });

    it("looks books up by id", () => {
      loadThree();
      expect(store.entityMap()[2]).toEqual(aBook(2));
      expect(store.entityMap()[9]).toBeUndefined();
    });
  });

  describe("price range", () => {
    it("is undefined while there are no books", () => {
      expect(store.priceRange()).toBeUndefined();
    });

    it("is the cheapest and the dearest book", () => {
      store.load();
      http.expectOne(url).flush([aBook(1, { price: 250 }), aBook(2, { price: 40 }), aBook(3, { price: 900 })]);
      expect(store.priceRange()).toEqual({ min: 40, max: 900 });
    });
  });

  describe("add", () => {
    it("sends the form, adds the saved book without refetching, says so and returns to the admin list", () => {
      loadThree();
      const form = new FormData();
      store.add(form);

      const request = http.expectOne(url);
      expect(request.request.method).toBe("POST");
      expect(request.request.body).toBe(form);
      request.flush(aBook(4));

      expect(ids()).toEqual([1, 2, 3, 4]);
      expect(snackbar.messages).toEqual(["Book added successfully"]);
      expect(navigate).toHaveBeenCalledWith(["/admin/books"]);
    });

    it("on failure changes nothing and says to try again", () => {
      loadThree();
      store.add(new FormData());
      http.expectOne(url).flush({ detail: "Bad file" }, { status: 400, statusText: "Bad Request" });

      expect(ids()).toEqual([1, 2, 3]);
      expect(snackbar.messages).toEqual(["Error occurred: Please try again"]);
      expect(navigate).not.toHaveBeenCalled();
      expect(store.loaded()).toBe(true);
    });

    it("ignores a second submit while the first is under way", () => {
      loadThree();
      store.add(new FormData());
      store.add(new FormData());
      http.expectOne(url).flush(aBook(4));
    });
  });

  describe("update", () => {
    it("replaces the book with the saved one, says so and returns to the admin list", () => {
      loadThree();
      store.update(new FormData());

      const request = http.expectOne(url);
      expect(request.request.method).toBe("PUT");
      request.flush(aBook(2, { title: "Renamed", price: 999 }));

      expect(store.entityMap()[2].title).toBe("Renamed");
      expect(store.priceRange()).toEqual({ min: 100, max: 999 });
      expect(ids()).toEqual([1, 2, 3]);
      expect(snackbar.messages).toEqual(["Book updated successfully"]);
      expect(navigate).toHaveBeenCalledWith(["/admin/books"]);
    });

    it("on failure changes nothing and says to try again", () => {
      loadThree();
      store.update(new FormData());
      http.expectOne(url).flush(null, { status: 500, statusText: "Server Error" });

      expect(store.entityMap()[2]).toEqual(aBook(2));
      expect(snackbar.messages).toEqual(["Error occurred: Please try again"]);
    });
  });

  describe("remove", () => {
    it("removes the book from the list and says so", () => {
      loadThree();
      store.remove(2);

      const request = http.expectOne(`${url}/2`);
      expect(request.request.method).toBe("DELETE");
      request.flush(null);

      expect(ids()).toEqual([1, 3]);
      expect(snackbar.messages).toEqual(["Book deleted successfully"]);
    });

    it("keeps the book when the server refuses", () => {
      loadThree();
      store.remove(2);
      http.expectOne(`${url}/2`).flush(null, { status: 500, statusText: "Server Error" });

      expect(ids()).toEqual([1, 2, 3]);
      expect(snackbar.messages).toEqual(["Error occurred: Please try again"]);
    });

    it("deletes several books one after the other", () => {
      loadThree();
      store.remove(1);
      store.remove(2);
      http.expectOne(`${url}/1`).flush(null);
      http.expectOne(`${url}/2`).flush(null);
      expect(ids()).toEqual([3]);
    });
  });
});
