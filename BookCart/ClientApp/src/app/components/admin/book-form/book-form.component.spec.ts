import { ComponentFixture, TestBed } from "@angular/core/testing";
import { aBook } from "src/app/testing/fixtures";
import { BookFormComponent, BookFormSubmit } from "./book-form.component";

describe("BookFormComponent", () => {
  let fixture: ComponentFixture<BookFormComponent>;
  let component: BookFormComponent;
  let saved: BookFormSubmit[];
  let cancelled: number;
  const root = () => fixture.nativeElement as HTMLElement;
  const field = (name: string) => root().querySelector(`input[formcontrolname="${name}"]`) as HTMLInputElement;
  const type = (name: string, value: string) => {
    field(name).value = value;
    field(name).dispatchEvent(new Event("input"));
  };
  const submit = () => (root().querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit"));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BookFormComponent] });
    fixture = TestBed.createComponent(BookFormComponent);
    component = fixture.componentInstance;
    saved = [];
    cancelled = 0;
    component.save.subscribe((s) => saved.push(s));
    component.cancel.subscribe(() => cancelled++);
    fixture.componentRef.setInput("categories", [{ categoryId: 1, categoryName: "Fiction" }]);
    fixture.detectChanges();
  });

  it("is an Add form with nothing filled in when there is no book", () => {
    expect(root().querySelector("mat-card-title")?.textContent).toContain("Add Book");
    expect(field("title").value).toBe("");
  });

  it("will not save an incomplete form", () => {
    type("title", "Dune");
    submit();
    expect(saved).toEqual([]);
  });

  it("saves a new book as one field per property, not as an update", () => {
    type("title", "Dune");
    type("author", "Frank Herbert");
    component.bookForm.patchValue({ category: "Fiction" });
    type("price", "250");
    submit();

    expect(saved.length).toBe(1);
    expect(saved[0].isUpdate).toBe(false);
    const data = saved[0].formData;
    expect(data.get("title")).toBe("Dune");
    expect(data.get("author")).toBe("Frank Herbert");
    expect(data.get("category")).toBe("Fiction");
    expect(data.get("price")).toBe("250");
    expect(data.get("bookId")).toBe("0");
    expect(data.has("file")).toBe(false);
  });

  it("fills itself from the book it is given and becomes an Edit form", async () => {
    fixture.componentRef.setInput("book", aBook(5, { title: "Emma", price: 90 }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(root().querySelector("mat-card-title")?.textContent).toContain("Edit Book");
    expect(field("title").value).toBe("Emma");
    expect(root().querySelector("img.preview-image")?.getAttribute("src")).toBe("/Upload/cover5.png");
  });

  it("saves an edit as an update of that book", async () => {
    fixture.componentRef.setInput("book", aBook(5, { title: "Emma", category: "Fiction", price: 90 }));
    fixture.detectChanges();
    await fixture.whenStable();
    submit();

    expect(saved.length).toBe(1);
    expect(saved[0].isUpdate).toBe(true);
    expect(saved[0].formData.get("bookId")).toBe("5");
  });

  it("does not overwrite what the admin has typed when the book is reloaded", async () => {
    fixture.componentRef.setInput("book", aBook(5, { title: "Emma" }));
    fixture.detectChanges();
    await fixture.whenStable();
    type("title", "Emma (2nd edition)");
    field("title").dispatchEvent(new Event("input"));
    component.bookForm.markAsDirty();

    fixture.componentRef.setInput("book", aBook(5, { title: "Emma" }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(field("title").value).toBe("Emma (2nd edition)");
  });

  it("reports a cancel", () => {
    const buttons = Array.from(root().querySelectorAll("button")) as HTMLButtonElement[];
    buttons.find((b) => b.textContent?.includes("Cancel"))!.click();
    expect(cancelled).toBe(1);
  });
});
