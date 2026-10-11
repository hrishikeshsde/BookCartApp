import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { Store } from "@ngrx/store";
import { of, switchMap } from "rxjs";
import {
  addBook,
  cancelBookFormNavigation,
  loadBooks,
  updateBook,
} from "src/app/state/actions/book.actions";
import { loadCategories } from "src/app/state/actions/categories.actions";
import { selectBookById } from "src/app/state/selectors/book.selectors";
import { selectCategories } from "src/app/state/selectors/categories.selectors";
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
  private readonly store = inject(Store);

  /** The :id in /admin/books/:id (there is none for /admin/books/new). */
  readonly id = input<string>();

  protected readonly book = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        id ? this.store.select(selectBookById(Number(id))) : of(undefined)
      )
    )
  );
  protected readonly categories = this.store.selectSignal(selectCategories);

  constructor() {
    // Opened by its address (a refresh), the page has no books yet: without them an edit page would show a blank
    // "Add" form, and saving that would create a second copy of the book.
    this.store.dispatch(loadBooks());
    this.store.dispatch(loadCategories());
  }

  protected save({ formData, isUpdate }: BookFormSubmit) {
    this.store.dispatch(
      isUpdate ? updateBook({ book: formData }) : addBook({ book: formData })
    );
  }

  protected cancel() {
    this.store.dispatch(cancelBookFormNavigation());
  }
}
