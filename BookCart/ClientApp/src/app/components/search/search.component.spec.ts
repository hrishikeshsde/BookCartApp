import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SearchComponent } from "./search.component";
import { aBook } from "src/app/testing/fixtures";

describe("SearchComponent", () => {
  let fixture: ComponentFixture<SearchComponent>;
  let component: SearchComponent;
  let searched: string[];
  let cleared: number;
  const root = () => fixture.nativeElement as HTMLElement;
  const box = () => root().querySelector("input.searchbox") as HTMLInputElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SearchComponent] });
    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    searched = [];
    cleared = 0;
    component.searched.subscribe((text) => searched.push(text));
    component.cleared.subscribe(() => cleared++);
    fixture.componentRef.setInput("books", [
      aBook(1, { title: "Dune", author: "Frank Herbert" }),
      aBook(2, { title: "Emma", author: "Jane Austen" }),
    ]);
    fixture.detectChanges();
  });

  const type = (text: string) => {
    box().value = text;
    box().dispatchEvent(new Event("input"));
  };
  const pressEnter = () => box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  /** Chrome fires "search" on Enter in a type=search box, and on its clear (x) button. */
  const browserSearchEvent = () => box().dispatchEvent(new Event("search", { bubbles: true }));

  it("Enter reports what was typed, in lower case", () => {
    type("Dune");
    pressEnter();
    expect(searched).toEqual(["dune"]);
    expect(cleared).toBe(0);
  });

  it("Enter in an empty box asks to show everything again", () => {
    pressEnter();
    expect(searched).toEqual([]);
    expect(cleared).toBe(1);
  });

  it("the browser's own 'search' event does not undo a search that has text (it used to send the visitor home)", () => {
    type("Dune");
    pressEnter();
    browserSearchEvent();
    expect(searched).toEqual(["dune"]);
    expect(cleared).toBe(0);
  });

  it("clearing the box with its (x) button asks to show everything again", () => {
    type("");
    browserSearchEvent();
    expect(cleared).toBe(1);
  });

  it("shows the search text it is given", async () => {
    fixture.componentRef.setInput("searchText", "emma");
    fixture.detectChanges();
    await fixture.whenStable();
    expect(box().value).toBe("emma");
  });

  it("suggests the books whose title or author contains what is typed", () => {
    type("herb");
    fixture.detectChanges();
    const suggestions = (component as unknown as { suggestions: () => { title: string }[] }).suggestions();
    expect(suggestions.map((book) => book.title)).toEqual(["Dune"]);
  });

  it("suggests nothing for an empty box", () => {
    const suggestions = (component as unknown as { suggestions: () => unknown[] }).suggestions();
    expect(suggestions).toEqual([]);
  });
});
