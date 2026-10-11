import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { MockStore, provideMockStore } from "@ngrx/store/testing";
import { selectBooks, selectSearchItemValue } from "src/app/state/selectors/book.selectors";
import { aBook } from "src/app/testing/fixtures";
import { SearchComponent } from "./search.component";

describe("SearchComponent", () => {
  let fixture: ComponentFixture<SearchComponent>;
  let component: SearchComponent;
  let store: MockStore;
  let navigate: Mock;
  const box = () => (fixture.nativeElement as HTMLElement).querySelector("input.searchbox") as HTMLInputElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectBooks, value: [aBook(1, { title: "Dune" })] },
            { selector: selectSearchItemValue, value: "" },
          ],
        }),
      ],
    });
    store = TestBed.inject(MockStore);
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => store.resetSelectors());

  const pressEnter = () => box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  /** Chrome fires "search" on Enter in a type=search box, and on its clear (x) button. */
  const browserSearchEvent = () => box().dispatchEvent(new Event("search"));

  it("Enter searches for what was typed, in lower case", () => {
    component.searchControl.setValue("Dune");
    pressEnter();
    expect(navigate).toHaveBeenCalledWith(["/search"], { queryParams: { item: "dune" } });
  });

  it("Enter in an empty box goes back to the full list", () => {
    pressEnter();
    expect(navigate).toHaveBeenCalledWith(["/"]);
  });

  it("the browser's own 'search' event does not undo a search that has text (it used to send the visitor home)", () => {
    component.searchControl.setValue("Dune");
    pressEnter();
    browserSearchEvent();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/search"], { queryParams: { item: "dune" } });
  });

  it("clearing the box with its (x) button goes back to the full list", () => {
    component.searchControl.setValue("");
    browserSearchEvent();
    expect(navigate).toHaveBeenCalledWith(["/"]);
  });
});
