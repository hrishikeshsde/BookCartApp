import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideStore, Store } from "@ngrx/store";
import { addBook, cancelBookFormNavigation, loadBooks, loadBooksSuccess, updateBook } from "src/app/state/actions/book.actions";
import { loadCategories, loadCategoriesSuccess } from "src/app/state/actions/categories.actions";
import { BOOK_FEATURE_KEY, bookReducer } from "src/app/state/reducers/book.reducers";
import { CATEGORIES_FEATURE_KEY, categoryReducer } from "src/app/state/reducers/categories.reducers";
import { aBook } from "src/app/testing/fixtures";
import { BookFormComponent } from "../book-form/book-form.component";
import { BookFormPageComponent } from "./book-form-page.component";

describe("BookFormPageComponent", () => {
  let fixture: ComponentFixture<BookFormPageComponent>;
  let store: Store;
  let dispatch: ReturnType<typeof vi.spyOn>;
  const form = () => fixture.debugElement.children[0].componentInstance as BookFormComponent;
  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BookFormPageComponent],
      providers: [provideStore({ [BOOK_FEATURE_KEY]: bookReducer, [CATEGORIES_FEATURE_KEY]: categoryReducer })],
    });
    store = TestBed.inject(Store);
    dispatch = vi.spyOn(store, "dispatch");
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
    expect(dispatch).toHaveBeenCalledWith(loadBooks());
    expect(dispatch).toHaveBeenCalledWith(loadCategories());
  });

  it("gives the form the book the address names once the books have arrived", async () => {
    open("5");
    expect(root().querySelector("mat-card-title")?.textContent).toContain("Add Book");

    store.dispatch(loadBooksSuccess({ books: [aBook(4), aBook(5, { title: "Emma" })] }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root().querySelector("mat-card-title")?.textContent).toContain("Edit Book");
    expect(root().querySelector<HTMLInputElement>('input[formcontrolname="title"]')?.value).toBe("Emma");
  });

  it("gives the form the categories", () => {
    open();
    store.dispatch(loadCategoriesSuccess({ genres: [{ categoryId: 1, categoryName: "Fiction" }] }));
    fixture.detectChanges();
    expect(form().categories()).toEqual([{ categoryId: 1, categoryName: "Fiction" }]);
  });

  it("files a new book as an add", () => {
    open();
    const formData = new FormData();
    form().save.emit({ formData, isUpdate: false });
    expect(dispatch).toHaveBeenCalledWith(addBook({ book: formData }));
  });

  it("files an edit as an update", () => {
    open("5");
    const formData = new FormData();
    form().save.emit({ formData, isUpdate: true });
    expect(dispatch).toHaveBeenCalledWith(updateBook({ book: formData }));
  });

  it("leaves the form when it is cancelled", () => {
    open();
    form().cancel.emit();
    expect(dispatch).toHaveBeenCalledWith(cancelBookFormNavigation());
  });
});
