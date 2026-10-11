import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { toggleWishlistItem } from "src/app/state/actions/wishlist.actions";
import { selectWishlistItems } from "src/app/state/selectors/wishlist.selectors";
import { aBook } from "src/app/testing/fixtures";
import { AddtowishlistComponent } from "./addtowishlist.component";

describe("AddtowishlistComponent", () => {
  let fixture: ComponentFixture<AddtowishlistComponent>;
  let store: MockStore;
  const label = () => (fixture.nativeElement as HTMLElement).querySelector("button")?.textContent?.trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AddtowishlistComponent],
      providers: [provideMockStore({ selectors: [{ selector: selectWishlistItems, value: [] }] })],
    });
    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(AddtowishlistComponent);
    fixture.componentRef.setInput("bookId", 2);
    fixture.componentRef.setInput("showButton", true);
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  it("offers to add a book that is not on the wishlist", () => {
    expect(label()).toBe("Add to Wishlist");
  });

  it("offers to remove a book that is on it", () => {
    store.overrideSelector(selectWishlistItems, [aBook(2)]);
    store.refreshState();
    fixture.detectChanges();
    expect(label()).toBe("Remove from Wishlist");
  });

  it("follows the wishlist as it changes, and when the book it shows changes", () => {
    store.overrideSelector(selectWishlistItems, [aBook(2)]);
    store.refreshState();
    fixture.detectChanges();
    expect(label()).toBe("Remove from Wishlist");

    // the same component instance is reused for another book (not on the list)
    fixture.componentRef.setInput("bookId", 9);
    fixture.detectChanges();
    expect(label()).toBe("Add to Wishlist");
  });

  it("clicking asks the store to add, and then to remove", () => {
    spyOn(store, "dispatch");
    const button = (fixture.nativeElement as HTMLElement).querySelector("button") as HTMLButtonElement;

    button.click();
    expect(store.dispatch).toHaveBeenCalledWith(toggleWishlistItem({ bookId: 2, isAdd: true }));

    button.click();
    expect(store.dispatch).toHaveBeenCalledWith(toggleWishlistItem({ bookId: 2, isAdd: false }));
  });
});
