import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormControl, FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  MatAutocomplete,
  MatAutocompleteTrigger,
} from "@angular/material/autocomplete";
import { MatOption } from "@angular/material/core";
import { Book } from "src/app/models/book";

/**
 * The search box with title suggestions. It is given the books to suggest from and the text to show; it reports what
 * the visitor searched for (or that they cleared the box) and leaves navigation to the page around it.
 */
@Component({
  selector: "app-search",
  templateUrl: "./search.component.html",
  styleUrls: ["./search.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatAutocompleteTrigger,
    MatAutocomplete,
    MatOption,
  ],
})
export class SearchComponent {
  readonly books = input<Book[]>([]);
  /** The text the box should show (the search text the page holds). */
  readonly searchText = input("");
  /** The search text, in lower case. Not named `search`: that is also a DOM event of the inner input, and it bubbles. */
  readonly searched = output<string>();
  /** The box was emptied: show everything again. */
  readonly cleared = output<void>();

  readonly searchControl = new FormControl("", { nonNullable: true });
  private readonly typed = toSignal(this.searchControl.valueChanges, {
    initialValue: "",
  });

  protected readonly suggestions = computed(() => {
    const value = this.typed().toLowerCase();
    if (value.length === 0) {
      return [];
    }
    return this.books().filter(
      (book) =>
        book.title.toLowerCase().includes(value) ||
        book.author.toLowerCase().includes(value)
    );
  });

  constructor() {
    effect(() => this.searchControl.setValue(this.searchText()));
  }

  searchBooks() {
    const searchItem = this.searchControl.value;
    if (searchItem !== "") {
      this.searched.emit(searchItem.toLowerCase());
    } else {
      this.cleared.emit();
    }
  }

  /** Chrome fires "search" on Enter as well as on the clear button; only an empty box means "clear". */
  onSearchEvent() {
    if (this.searchControl.value === "") {
      this.cleared.emit();
    }
  }
}
