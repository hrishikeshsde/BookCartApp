import { provideHttpClient, withXhr } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { SnackbarService } from "src/app/services/snackbar.service";
import { TokenStorage } from "src/app/services/token-storage.service";
import { aCartItem, aToken, inOneHour } from "src/app/testing/fixtures";
import { SnackbarStub } from "src/app/testing/helpers";
import { AuthStore } from "../auth/auth.store";
import { CartStore } from "./cart.store";

const url = "/api/shoppingcart";

describe("CartStore", () => {
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

  /** The store, created and past its first load (as a guest unless signedInBefore() ran) answering with `items`. */
  function startWith(items = [aCartItem(1, 2), aCartItem(2, 1)]) {
    const store = TestBed.inject(CartStore);
    TestBed.tick();
    http.expectOne(url).flush(items);
    return store;
  }

  describe("starting", () => {
    it("loads the cart when the app starts, even for a guest (their cart is on the server, behind a cookie)", () => {
      const store = TestBed.inject(CartStore);
      TestBed.tick();
      expect(store.loading()).toBe(true);

      http.expectOne(url).flush([aCartItem(1, 2)]);

      expect(store.items().length).toBe(1);
      expect(store.loaded()).toBe(true);
    });

    it("loads it once for a visitor who is already signed in", () => {
      signedInBefore();
      startWith();
    });
  });

  describe("what it adds up", () => {
    it("the badge counts copies, not lines, and the total is price times copies", () => {
      const store = startWith([aCartItem(1, 2), aCartItem(2, 3)]); // prices 100 and 200
      expect(store.count()).toBe(5);
      expect(store.total()).toBe(2 * 100 + 3 * 200);
    });

    it("an empty cart counts zero", () => {
      const store = startWith([]);
      expect(store.count()).toBe(0);
      expect(store.total()).toBe(0);
    });
  });

  describe("changing the cart", () => {
    it("add: posts the book and shows the cart the server answers with", () => {
      const store = startWith();
      store.add(3);
      expect(store.loading()).toBe(true);

      const request = http.expectOne(`${url}/items/3`);
      expect(request.request.method).toBe("POST");
      request.flush([aCartItem(3, 1)]);

      expect(store.items().map((item) => item.book.bookId)).toEqual([3]);
      expect(store.loaded()).toBe(true);
      expect(snackbar.messages).toEqual(["One Item added to cart"]);
    });

    it("reduce: takes one copy off", () => {
      const store = startWith();
      store.reduce(1);
      const request = http.expectOne(`${url}/items/1`);
      expect(request.request.method).toBe("PATCH");
      request.flush([aCartItem(1, 1), aCartItem(2, 1)]);

      expect(store.items()[0].quantity).toBe(1);
      expect(snackbar.messages).toEqual(["One item removed from cart"]);
    });

    it("remove: takes the whole line off", () => {
      const store = startWith();
      store.remove(1);
      const request = http.expectOne(`${url}/items/1`);
      expect(request.request.method).toBe("DELETE");
      request.flush([aCartItem(2, 1)]);

      expect(store.items().map((item) => item.book.bookId)).toEqual([2]);
      expect(snackbar.messages).toEqual(["Book removed from cart"]);
    });

    it("clear: empties it", () => {
      const store = startWith();
      store.clear();
      const request = http.expectOne(url);
      expect(request.request.method).toBe("DELETE");
      request.flush(null);

      expect(store.items()).toEqual([]);
      expect(snackbar.messages).toEqual(["Cart cleared"]);
    });

    it("a failed call keeps the cart as it was and records the reason", () => {
      const store = startWith();
      store.add(3);
      http.expectOne(`${url}/items/3`).flush({ detail: "Out of stock" }, { status: 409, statusText: "Conflict" });

      expect(store.items().length).toBe(2);
      expect(store.error()).toBe("Out of stock");
      expect(snackbar.messages).toEqual([]);
    });

    it("loading again while a load is under way cancels the earlier request", () => {
      const store = startWith();
      store.load();
      const first = http.expectOne(url);
      store.load();
      expect(first.cancelled).toBe(true);
      http.expectOne(url).flush([]);
    });
  });

  describe("signing in and out", () => {
    it("signing in loads the cart again: the server has merged the guest cart into the user's", () => {
      const store = startWith([aCartItem(1, 1)]);
      const auth = TestBed.inject(AuthStore);

      auth.login({ credentials: { username: "reader", password: "Abcdefg1" } });
      http.expectOne("/api/login").flush({ token: aToken({ userId: "7", name: "reader", role: "User", exp: inOneHour() }) });
      TestBed.tick();

      http.expectOne(url).flush([aCartItem(1, 1), aCartItem(5, 2)]);
      expect(store.items().length).toBe(2);
    });

    it("signing out empties the cart and does not load another", () => {
      signedInBefore();
      const store = startWith();

      TestBed.inject(AuthStore).logout();
      TestBed.tick();

      expect(store.items()).toEqual([]);
      expect(store.count()).toBe(0);
      expect(store.loaded()).toBe(false);
      http.expectNone(url);
    });
  });
});
