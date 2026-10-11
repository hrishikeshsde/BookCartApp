import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { logout } from "src/app/state/actions/auth.actions";
import { selectAuthenticatedUser, selectIsAuthenticated } from "src/app/state/selectors/auth.selectors";
import { selectBooks, selectSearchItemValue } from "src/app/state/selectors/book.selectors";
import { selectCarttemsCount } from "src/app/state/selectors/cart.selectors";
import { selectWishlistItemsCount } from "src/app/state/selectors/wishlist.selectors";
import { aBook } from "src/app/testing/fixtures";
import { SearchComponent } from "../search/search.component";
import { NavBarComponent } from "./nav-bar.component";

describe("NavBarComponent", () => {
  let fixture: ComponentFixture<NavBarComponent>;
  let store: MockStore;
  let navigate: Mock;
  const search = () => fixture.debugElement.query((el) => el.componentInstance instanceof SearchComponent).componentInstance as SearchComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NavBarComponent],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectIsAuthenticated, value: false },
            { selector: selectAuthenticatedUser, value: null },
            { selector: selectWishlistItemsCount, value: 0 },
            { selector: selectCarttemsCount, value: 0 },
            { selector: selectBooks, value: [aBook(1, { title: "Dune" })] },
            { selector: selectSearchItemValue, value: "dune" },
          ],
        }),
      ],
    });
    store = TestBed.inject(MockStore);
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    fixture = TestBed.createComponent(NavBarComponent);
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("gives the search box the books to suggest and the text being searched", async () => {
    await fixture.whenStable();
    expect(search().books().map((book) => book.title)).toEqual(["Dune"]);
    expect(search().searchControl.value).toBe("dune");
  });

  it("opens the search results page for a search", () => {
    search().searched.emit("emma");
    expect(navigate).toHaveBeenCalledWith(["/search"], { queryParams: { item: "emma" } });
  });

  it("goes back to the full list when the search is cleared", () => {
    search().cleared.emit();
    expect(navigate).toHaveBeenCalledWith(["/"]);
  });

  it("is not fooled by the browser's own bubbling 'search' event from the inner box (it once searched for \"[object Event]\")", () => {
    const box = fixture.nativeElement.querySelector("input.searchbox") as HTMLInputElement;
    box.value = "Dune";
    box.dispatchEvent(new Event("input"));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    box.dispatchEvent(new Event("search", { bubbles: true }));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/search"], { queryParams: { item: "dune" } });
  });

  it("logs out through the store", () => {
    const dispatch = vi.spyOn(store, "dispatch");
    fixture.componentInstance.logout();
    expect(dispatch).toHaveBeenCalledWith(logout());
  });
});
