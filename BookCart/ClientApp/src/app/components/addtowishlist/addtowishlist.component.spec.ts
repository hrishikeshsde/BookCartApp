import { ComponentFixture, TestBed } from "@angular/core/testing";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { AddtowishlistComponent } from "./addtowishlist.component";

describe("AddtowishlistComponent", () => {
  let fixture: ComponentFixture<AddtowishlistComponent>;
  let toggles: WishlistToggle[];
  const root = () => fixture.nativeElement as HTMLElement;
  const label = () => root().querySelector("button")?.textContent?.trim();

  function show(inputs: { showButton?: boolean; wishlisted?: boolean } = {}) {
    fixture = TestBed.createComponent(AddtowishlistComponent);
    fixture.componentRef.setInput("bookId", 2);
    fixture.componentRef.setInput("showButton", inputs.showButton ?? true);
    fixture.componentRef.setInput("wishlisted", inputs.wishlisted ?? false);
    toggles = [];
    fixture.componentInstance.toggle.subscribe((t) => toggles.push(t));
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [AddtowishlistComponent] }));

  it("offers to add a book that is not on the wishlist, and to remove one that is", () => {
    show({ wishlisted: false });
    expect(label()).toBe("Add to Wishlist");

    fixture.componentRef.setInput("wishlisted", true);
    fixture.detectChanges();
    expect(label()).toBe("Remove from Wishlist");
  });

  it("reports an add, and shows it at once without waiting for the server", () => {
    show({ wishlisted: false });

    root().querySelector("button")!.click();
    fixture.detectChanges();

    expect(toggles).toEqual([{ bookId: 2, isAdd: true }]);
    expect(label()).toBe("Remove from Wishlist");
  });

  it("reports a removal", () => {
    show({ wishlisted: true });
    root().querySelector("button")!.click();
    expect(toggles).toEqual([{ bookId: 2, isAdd: false }]);
  });

  it("goes back to what the parent says when the parent's answer changes", () => {
    show({ wishlisted: false });
    root().querySelector("button")!.click();
    fixture.detectChanges();
    expect(label()).toBe("Remove from Wishlist");

    // the book is shown for another one that is not on the list
    fixture.componentRef.setInput("wishlisted", true);
    fixture.detectChanges();
    fixture.componentRef.setInput("wishlisted", false);
    fixture.detectChanges();

    expect(label()).toBe("Add to Wishlist");
  });

  it("is a heart unless it is asked to be a button, and the heart shows the state", () => {
    show({ showButton: false, wishlisted: false });
    expect(root().querySelector("button")).toBeNull();
    expect(root().querySelector(".favourite-unselected")).not.toBeNull();

    fixture.componentRef.setInput("wishlisted", true);
    fixture.detectChanges();
    expect(root().querySelector(".favourite-selected")).not.toBeNull();

    (root().querySelector(".favourite-selected") as HTMLElement).click();
    expect(toggles).toEqual([{ bookId: 2, isAdd: false }]);
  });
});
