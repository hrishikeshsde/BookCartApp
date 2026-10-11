import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { BookFilterComponent } from "./book-filter.component";

const categories = [
  { categoryId: 1, categoryName: "Fiction" },
  { categoryId: 2, categoryName: "Biography" },
];

describe("BookFilterComponent", () => {
  let fixture: ComponentFixture<BookFilterComponent>;
  const items = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("mat-list-item"));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BookFilterComponent], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(BookFilterComponent);
    fixture.componentRef.setInput("categories", categories);
    fixture.detectChanges();
  });

  it("lists All Categories first, then each category", () => {
    expect(items().map((i) => i.textContent?.trim())).toEqual(["All Categories", "Fiction", "Biography"]);
  });

  it("marks All Categories when no category is chosen", () => {
    expect(items()[0].classList).toContain("active-category");
    expect(items()[1].classList).not.toContain("active-category");
  });

  it("marks the chosen category (the address carries it in lower case)", () => {
    fixture.componentRef.setInput("category", "biography");
    fixture.detectChanges();

    expect(items()[0].classList).not.toContain("active-category");
    expect(items()[2].classList).toContain("active-category");
  });
});
