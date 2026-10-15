import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { BookFilterComponent } from "./book-filter.component";

const categories = [
  { categoryId: 1, categoryName: "Fiction" },
  { categoryId: 2, categoryName: "Biography" },
];

describe("BookFilterComponent", () => {
  let fixture: ComponentFixture<BookFilterComponent>;
  const items = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("a"));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BookFilterComponent], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(BookFilterComponent);
    fixture.componentRef.setInput("categories", categories);
    fixture.detectChanges();
  });

  it("lists All Categories first, then each category", () => {
    expect(items().map((i) => i.textContent?.trim())).toEqual(["All Categories", "Fiction", "Biography"]);
  });

  it("the categories are links (a keyboard can reach them)", () => {
    expect(items().map((i) => i.getAttribute("href"))).toEqual(["/", "/filter?category=fiction", "/filter?category=biography"]);
  });

  it("marks All Categories as the current page when no category is chosen", () => {
    expect(items()[0].getAttribute("aria-current")).toBe("page");
    expect(items()[1].getAttribute("aria-current")).toBeNull();
  });

  it("marks the chosen category as the current page (the address carries it in lower case)", () => {
    fixture.componentRef.setInput("category", "biography");
    fixture.detectChanges();

    expect(items()[0].getAttribute("aria-current")).toBeNull();
    expect(items()[2].getAttribute("aria-current")).toBe("page");
  });
});
