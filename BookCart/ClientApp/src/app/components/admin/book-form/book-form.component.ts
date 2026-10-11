import { AsyncPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { MatButton } from "@angular/material/button";
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatOption } from "@angular/material/core";
import {
  MatError,
  MatFormField,
  MatLabel,
  MatPrefix,
} from "@angular/material/form-field";
import { MatIcon } from "@angular/material/icon";
import { MatInput } from "@angular/material/input";
import { MatSelect } from "@angular/material/select";
import { Router } from "@angular/router";
import { Store } from "@ngrx/store";
import { combineLatest, EMPTY } from "rxjs";
import { catchError, map } from "rxjs/operators";
import { SnackbarService } from "src/app/services/snackbar.service";
import { Book } from "src/app/models/book";
import { addBook, updateBook } from "src/app/state/actions/book.actions";
import { loadCategories } from "src/app/state/actions/categories.actions";
import { selectCurrentBookDetails } from "src/app/state/selectors/book.selectors";
import { selectCategories } from "src/app/state/selectors/categories.selectors";

@Component({
    selector: "app-book-form",
    templateUrl: "./book-form.component.html",
    styleUrls: ["./book-form.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatCard,
        MatCardHeader,
        MatCardTitle,
        MatCardContent,
        ReactiveFormsModule,
        MatFormField,
        MatLabel,
        MatInput,
        MatError,
        MatSelect,
        MatOption,
        MatPrefix,
        MatCardActions,
        MatButton,
        MatIcon,
        AsyncPipe,
    ]
})
export class BookFormComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly snackBarService = inject(SnackbarService);
  private readonly store = inject(Store);

  coverImagePath = "";
  files: FileList | null = null;

  bookForm = this.fb.group({
    bookId: 0,
    title: ["", Validators.required],
    author: ["", Validators.required],
    category: ["", Validators.required],
    price: ["", [Validators.required, Validators.min(0)]],
  });

  bookFormData$ = combineLatest([
    this.store.select(selectCurrentBookDetails),
    this.store.select(selectCategories),
  ]).pipe(
    map(([book, categoryList]) => {
      if (book !== undefined) {
        this.setBookFormData(book);
      }
      return {
        formTitle: book?.bookId ? "Edit" : "Add",
        categoryList,
      };
    }),
    catchError((error) => {
      this.snackBarService.showSnackBar(
        "Error ocurred while fetching book data"
      );
      console.error("Error ocurred while fetching book data : ", error);
      return EMPTY;
    })
  );

  constructor() {
    this.store.dispatch(loadCategories());
  }

  protected get bookFormControl() {
    return this.bookForm.controls;
  }

  onFormSubmit() {
    if (!this.bookForm.valid) {
      return;
    }
    // One field per book property, as the API binds them. Built fresh on every submit: a form object kept between
    // submits would carry the fields of the previous attempt.
    const { bookId, title, author, category, price } = this.bookForm.getRawValue();
    const formData = new FormData();
    formData.append("bookId", String(bookId));
    formData.append("title", title);
    formData.append("author", author);
    formData.append("category", category);
    formData.append("price", String(price));
    if (this.files && this.files.length > 0) {
      formData.append("file", this.files[0]);
    }

    if (bookId > 0) {
      this.store.dispatch(updateBook({ book: formData }));
    } else {
      this.store.dispatch(addBook({ book: formData }));
    }
  }

  uploadImage(event: Event) {
    const input = event.target as HTMLInputElement;
    this.files = input.files;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      this.coverImagePath = reader.result as string;
    };
  }

  navigateToAdminPanel() {
    this.router.navigate(["/admin/books"]);
  }

  private setBookFormData(bookFormData: Book) {
    this.bookForm.setValue({
      bookId: bookFormData.bookId,
      title: bookFormData.title,
      author: bookFormData.author,
      category: bookFormData.category,
      price: String(bookFormData.price),
    });
    this.coverImagePath = "/Upload/" + bookFormData.coverFileName;
  }
}
