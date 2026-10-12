import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { BookService } from "src/app/services/book.service";
import { BooksStore } from "src/app/state/books/books.store";
import { fakeBooksStore } from "src/app/testing/fake-books-store";
import { aBook } from "src/app/testing/fixtures";
import { BookFormComponent } from "../book-form/book-form.component";
import { BookFormPageComponent } from "./book-form-page.component";

describe("BookFormPageComponent", () => {
  let fixture: ComponentFixture<BookFormPageComponent>;
  let booksStore: ReturnType<typeof fakeBooksStore>;
  let navigate: ReturnType<typeof vi.spyOn>;
  const getCategories = vi.fn(() => of([{ categoryId: 1, categoryName: "Fiction" }]));
  const form = () => fixture.debugElement.children[0].componentInstance as BookFormComponent;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    booksStore = fakeBooksStore([], "init");
    TestBed.configureTestingModule({
      imports: [BookFormPageComponent],
      providers: [
        provideRouter([]),
        { provide: BooksStore, useValue: booksStore },
        { provide: BookService, useValue: { getCategories } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    getCategories.mockClear();
  });

  const open = (id?: string) => {
    fixture = TestBed.createComponent(BookFormPageComponent);
    if (id !== undefined) {
      fixture.componentRef.setInput("id", id);
    }
    fixture.detectChanges();
  };

  it("loads the books and the categories itself, so a page opened by its address (a refresh) has them", () => {
    open("5");
    expect(booksStore.load).toHaveBeenCalled();
    expect(getCategories).toHaveBeenCalledTimes(1);
  });

  it("gives the form the book the address names once the books have arrived", async () => {
    open("5");
    expect(root().querySelector("mat-card-title")?.textContent).toContain("Add Book");

    booksStore.entities.set([aBook(4), aBook(5, { title: "Emma" })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root().querySelector("mat-card-title")?.textContent).toContain("Edit Book");
    expect(root().querySelector<HTMLInputElement>('input[formcontrolname="title"]')?.value).toBe("Emma");
  });

  it("gives the form the categories", () => {
    open();
    fixture.detectChanges();
    expect(form().categories()).toEqual([{ categoryId: 1, categoryName: "Fiction" }]);
  });

  it("files a new book as an add", () => {
    open();
    const formData = new FormData();
    form().save.emit({ formData, isUpdate: false });
    expect(booksStore.add).toHaveBeenCalledWith(formData);
    expect(booksStore.update).not.toHaveBeenCalled();
  });

  it("files an edit as an update", () => {
    open("5");
    const formData = new FormData();
    form().save.emit({ formData, isUpdate: true });
    expect(booksStore.update).toHaveBeenCalledWith(formData);
    expect(booksStore.add).not.toHaveBeenCalled();
  });

  it("goes back to the admin books when it is cancelled", () => {
    open();
    form().cancel.emit();
    expect(navigate).toHaveBeenCalledWith(["/admin/books"]);
  });
});
