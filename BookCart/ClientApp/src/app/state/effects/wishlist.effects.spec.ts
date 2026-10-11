import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { Subject } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { aBook, aUser } from "src/app/testing/fixtures";
import { collect, SnackbarStub } from "src/app/testing/helpers";
import { setAuthState } from "../actions/auth.actions";
import {
  clearWishlist,
  clearWishlistSuccess,
  loadWishlist,
  loadWishlistFailure,
  loadWishlistSuccess,
  toggleWishlistItem,
  toggleWishlistItemSuccess,
} from "../actions/wishlist.actions";
import { selectAuthenticatedUser } from "../selectors/auth.selectors";
import { WishlistEffects } from "./wishlist.effects";

describe("WishlistEffects", () => {
  let actions$: Subject<Action>;
  let effects: WishlistEffects;
  let http: HttpTestingController;
  let store: MockStore;
  let snackbar: SnackbarStub;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        WishlistEffects,
        provideMockActions(() => actions$),
        provideMockStore({ selectors: [{ selector: selectAuthenticatedUser, value: aUser() }] }),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    effects = TestBed.inject(WishlistEffects);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MockStore);
  });
  afterEach(() => {
    http.verify();
    store.resetSelectors();
  });

  it("loads the wishlist of a signed-in user, on request and right after login", () => {
    const out = collect(effects.loadWishlist$);

    actions$.next(loadWishlist());
    http.expectOne("/api/wishlist").flush([aBook(1)]);
    actions$.next(setAuthState({ user: aUser() }));
    http.expectOne("/api/wishlist").flush([aBook(1), aBook(2)]);

    expect(out).toEqual([
      loadWishlistSuccess({ wishlist: [aBook(1)] }),
      loadWishlistSuccess({ wishlist: [aBook(1), aBook(2)] }),
    ]);
  });

  it("does not ask the server for a guest's wishlist", () => {
    store.overrideSelector(selectAuthenticatedUser, null);
    const out = collect(effects.loadWishlist$);
    actions$.next(loadWishlist());
    http.expectNone("/api/wishlist");
    expect(out).toEqual([loadWishlistFailure({ errorMessage: "User not found" })]);
  });

  it("adding says so, removing says so", () => {
    const out = collect(effects.toggleWishlist$);

    actions$.next(toggleWishlistItem({ bookId: 3, isAdd: true }));
    const add = http.expectOne("/api/wishlist/items/3");
    expect(add.request.method).toBe("POST");
    add.flush([aBook(3)]);

    actions$.next(toggleWishlistItem({ bookId: 3, isAdd: false }));
    http.expectOne("/api/wishlist/items/3").flush([]);

    expect(out).toEqual([toggleWishlistItemSuccess({ wishlist: [aBook(3)] }), toggleWishlistItemSuccess({ wishlist: [] })]);
    expect(snackbar.messages).toEqual(["Added to Wishlist!!!", "Removed from Wishlist!!!"]);
  });

  it("clears the list", () => {
    const out = collect(effects.clearWishlist$);
    actions$.next(clearWishlist());
    const request = http.expectOne("/api/wishlist");
    expect(request.request.method).toBe("DELETE");
    request.flush(null, { status: 204, statusText: "No Content" });
    expect(out).toEqual([clearWishlistSuccess()]);
  });
});
