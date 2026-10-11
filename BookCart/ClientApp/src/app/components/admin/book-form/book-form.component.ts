import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
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
import { Book } from "src/app/models/book";
import { Categories } from "src/app/models/categories";

/** What the form hands over when it is saved: the fields as the API wants them, and whether this edits an existing book. */
export interface BookFormSubmit {
  formData: FormData;
  isUpdate: boolean;
}

/**
 * The add/edit book form. It is given the book to edit (none for a new one) and the categories to choose from, and
 * reports a save or a cancel; the page around it talks to the store.
 */
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
  ],
})
export class BookFormComponent {
  private readonly fb = inject(NonNullableFormBuilder);

  /** The book being edited; undefined for a new one. */
  readonly book = input<Book>();
  readonly categories = input<Categories[]>([]);
  readonly save = output<BookFormSubmit>();
  readonly cancel = output<void>();

  protected readonly formTitle = computed(() =>
    this.book()?.bookId ? "Edit" : "Add"
  );
  protected readonly coverImagePath = signal("");
  private files: FileList | null = null;

  bookForm = this.fb.group({
    bookId: 0,
    title: ["", Validators.required],
    author: ["", Validators.required],
    category: ["", Validators.required],
    price: ["", [Validators.required, Validators.min(0)]],
  });

  constructor() {
    // Fill the form when the book arrives (or is reloaded), but never over what the admin has already typed.
    effect(() => {
      const book = this.book();
      if (book && this.bookForm.pristine) {
        this.bookForm.setValue({
          bookId: book.bookId,
          title: book.title,
          author: book.author,
          category: book.category,
          price: String(book.price),
        });
        this.coverImagePath.set("/Upload/" + book.coverFileName);
      }
    });
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
    const { bookId, title, author, category, price } =
      this.bookForm.getRawValue();
    const formData = new FormData();
    formData.append("bookId", String(bookId));
    formData.append("title", title);
    formData.append("author", author);
    formData.append("category", category);
    formData.append("price", String(price));
    if (this.files && this.files.length > 0) {
      formData.append("file", this.files[0]);
    }
    this.save.emit({ formData, isUpdate: bookId > 0 });
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
      this.coverImagePath.set(reader.result as string);
    };
  }
}
