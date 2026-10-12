import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { SnackbarService } from "src/app/services/snackbar.service";
import { TokenStorage } from "src/app/services/token-storage.service";
import { aBook, aToken, inOneHour } from "src/app/testing/fixtures";
import { SnackbarStub } from "src/app/testing/helpers";
import { AuthStore } from "../auth/auth.store";
import { WishlistStore } from "./wishlist.store";

const url = "/api/wishlist";

describe("WishlistStore", () => {
  let http: HttpTestingController;
  let snackbar: SnackbarStub;

  beforeEach(() => {
    localStorage.removeItem("authToken");
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    localStorage.removeItem("authToken");
  });

  const signedInBefore = () => TestBed.inject(TokenStorage).set(aToken({ userId: "7", name: "reader", role: "User", exp: inOneHour() }));

  /** A store for a signed-in visitor, past its first load, answering with `books`. */
  function startSignedInWith(books = [aBook(1), aBook(2)]) {
    signedInBefore();
    const store = TestBed.inject(WishlistStore);
    TestBed.tick();
    http.expectOne(url).flush(books);
    return store;
  }

  describe("for a guest", () => {
    it("sends nothing when the app starts, and is empty", () => {
      const store = TestBed.inject(WishlistStore);
      TestBed.tick();
      http.expectNone(url);
      expect(store.items()).toEqual([]);
      expect(store.count()).toBe(0);
    });

    it("every call is refused locally with 'User not found'", () => {
      const store = TestBed.inject(WishlistStore);
      store.load();
      expect(store.error()).toBe("User not found");
      store.toggle({ bookId: 1, isAdd: true });
      store.clear();
      http.expectNone(() => true);
      expect(snackbar.messages).toEqual([]);
    });
  });

  describe("for a signed-in visitor", () => {
    it("loads the wishlist when the app starts with a stored session", () => {
      const store = startSignedInWith([aBook(1), aBook(2)]);
      expect(store.items().length).toBe(2);
      expect(store.count()).toBe(2);
      expect(store.loaded()).toBe(true);
    });

    it("ids says which books are on it", () => {
      const store = startSignedInWith([aBook(4), aBook(9)]);
      expect(store.ids().has(4)).toBe(true);
      expect(store.ids().has(5)).toBe(false);
    });

    it("load fetches it again (the wishlist page does so each time it opens)", () => {
      const store = startSignedInWith([aBook(1)]);
      store.load();
      http.expectOne(url).flush([aBook(1), aBook(2)]);
      expect(store.count()).toBe(2);
    });

    it("toggle: posts the book and shows the list the server answers with, saying what happened", () => {
      const store = startSignedInWith([aBook(1)]);

      store.toggle({ bookId: 2, isAdd: true });
      const add = http.expectOne(`${url}/items/2`);
      expect(add.request.method).toBe("POST");
      add.flush([aBook(1), aBook(2)]);
      expect(store.count()).toBe(2);

      store.toggle({ bookId: 1, isAdd: false });
      http.expectOne(`${url}/items/1`).flush([aBook(2)]);
      expect(store.count()).toBe(1);

      expect(snackbar.messages).toEqual(["Added to Wishlist!!!", "Removed from Wishlist!!!"]);
    });

    it("clear: empties it and says so", () => {
      const store = startSignedInWith();
      store.clear();
      const request = http.expectOne(url);
      expect(request.request.method).toBe("DELETE");
      request.flush(null);

      expect(store.items()).toEqual([]);
      expect(snackbar.messages).toEqual(["Wishlist cleared!!!"]);
    });

    it("a failed call keeps the list and records the reason, with no message", () => {
      const store = startSignedInWith([aBook(1)]);
      store.toggle({ bookId: 2, isAdd: true });
      http.expectOne(`${url}/items/2`).flush({ detail: "No such book" }, { status: 404, statusText: "Not Found" });

      expect(store.items().length).toBe(1);
      expect(store.error()).toBe("No such book");
      expect(snackbar.messages).toEqual([]);
    });
  });

  describe("signing in and out", () => {
    it("signing in loads the wishlist", () => {
      const store = TestBed.inject(WishlistStore);
      TestBed.tick();
      http.expectNone(url);

      TestBed.inject(AuthStore).login({ credentials: { username: "reader", password: "Abcdefg1" } });
      http.expectOne("/api/login").flush({ token: aToken({ userId: "7", name: "reader", role: "User", exp: inOneHour() }) });
      TestBed.tick();

      http.expectOne(url).flush([aBook(3)]);
      expect(store.items().map((book) => book.bookId)).toEqual([3]);
    });

    it("signing out takes the wishlist away and loads nothing", () => {
      const store = startSignedInWith();

      TestBed.inject(AuthStore).logout();
      TestBed.tick();

      expect(store.items()).toEqual([]);
      expect(store.loaded()).toBe(false);
      http.expectNone(url);
    });
  });
});
