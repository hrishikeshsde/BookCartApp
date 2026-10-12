import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";
import { Router } from "@angular/router";
import { BooksStore } from "src/app/state/books/books.store";
import { CategoriesStore } from "src/app/state/categories/categories.store";
import {
  BookFormComponent,
  BookFormSubmit,
} from "../book-form/book-form.component";

/** /admin/books/new and /admin/books/:id: finds the book and the categories and files what the form saves. */
@Component({
  selector: "app-book-form-page",
  template: `<app-book-form
    [book]="book()"
    [categories]="categories()"
    (save)="save($event)"
    (cancel)="cancel()"
  ></app-book-form>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BookFormComponent],
})
export class BookFormPageComponent {
  private readonly booksStore = inject(BooksStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly router = inject(Router);

  /** The :id in /admin/books/:id (there is none for /admin/books/new). */
  readonly id = input<string>();

  protected readonly book = computed(() => {
    const id = this.id();
    return id ? this.booksStore.entityMap()[Number(id)] : undefined;
  });
  protected readonly categories = this.categoriesStore.categories;

  constructor() {
    // Opened by its address (a refresh), the page has no books yet: without them an edit page would show a blank
    // "Add" form, and saving that would create a second copy of the book.
    this.booksStore.load();
    this.categoriesStore.load();
  }

  protected save({ formData, isUpdate }: BookFormSubmit) {
    if (isUpdate) {
      this.booksStore.update(formData);
    } else {
      this.booksStore.add(formData);
    }
  }

  protected cancel() {
    this.router.navigate(["/admin/books"]);
  }
}
