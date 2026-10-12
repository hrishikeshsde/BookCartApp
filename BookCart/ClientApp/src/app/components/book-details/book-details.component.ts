import { CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from "@angular/core";
import { MatButton } from "@angular/material/button";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardImage,
  MatCardTitle,
} from "@angular/material/card";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { RouterLink } from "@angular/router";
import { finalize } from "rxjs";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { BookService } from "src/app/services/book.service";
import { BooksStore } from "src/app/state/books/books.store";
import { AuthStore } from "src/app/state/auth/auth.store";
import { CartStore } from "src/app/state/cart/cart.store";
import { SimilarBooksStore } from "src/app/state/similar-books/similar-books.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
import { AddtocartComponent } from "../addtocart/addtocart.component";
import { AddtowishlistComponent } from "../addtowishlist/addtowishlist.component";
import { BookSummaryComponent } from "../book-summary/book-summary.component";
import { SimilarbooksComponent } from "../similarbooks/similarbooks.component";

/**
 * The page for one book (/books/details/:id). It owns everything the panels on it need: the book, the similar books, the
 * wishlist and the AI summary; the panels only draw and report clicks.
 */
@Component({
  selector: "app-book-details",
  templateUrl: "./book-details.component.html",
  styleUrls: ["./book-details.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatCardImage,
    MatProgressSpinner,
    AddtocartComponent,
    AddtowishlistComponent,
    BookSummaryComponent,
    SimilarbooksComponent,
    MatButton,
    RouterLink,
    CurrencyPipe,
  ],
})
export class BookDetailsComponent {
  private readonly cart = inject(CartStore);
  private readonly wishlist = inject(WishlistStore);
  private readonly bookService = inject(BookService);
  private readonly booksStore = inject(BooksStore);

  /** The :id in /books/details/:id. */
  readonly id = input.required<string>();
  private readonly bookId = computed(() => Number(this.id()));

  private readonly signedIn = inject(AuthStore).isAuthenticated;

  protected readonly bookDetails = computed(() => ({
    book: this.booksStore.entityMap()[this.bookId()],
    isAuthenticated: this.signedIn(),
    isLoading: this.booksStore.loading(),
    hasError: this.booksStore.error() !== null,
  }));

  private readonly similarBooksStore = inject(SimilarBooksStore);
  protected readonly similarBooks = this.similarBooksStore.books;
  protected readonly similarLoading = this.similarBooksStore.loading;

  protected readonly wishlistedIds = this.wishlist.ids;

  // The summary starts empty again whenever the page shows another book.
  protected readonly summary = linkedSignal<number, string>({
    source: this.bookId,
    computation: () => "",
  });
  protected readonly summaryError = linkedSignal<number, string>({
    source: this.bookId,
    computation: () => "",
  });
  protected readonly summaryLoading = signal(false);

  constructor() {
    this.booksStore.load();
    // Whenever the page shows another book, fetch the books similar to it.
    this.similarBooksStore.load(this.bookId);
  }

  protected addToCart(bookId: number) {
    this.cart.add(bookId);
  }

  protected toggleWishlist({ bookId, isAdd }: WishlistToggle) {
    this.wishlist.toggle({ bookId, isAdd });
  }

  /** Asks the server for an AI-written summary of this book (the AI key never reaches the browser). */
  protected generateSummary() {
    const bookId = this.bookId();
    this.summaryLoading.set(true);
    this.summary.set("");
    this.summaryError.set("");
    this.bookService
      .getBookSummary(bookId)
      .pipe(finalize(() => this.summaryLoading.set(false)))
      .subscribe({
        // An answer for a book the page has moved away from is dropped.
        next: (result) => {
          if (bookId === this.bookId()) {
            this.summary.set(result.summary);
          }
        },
        error: () => {
          if (bookId === this.bookId()) {
            this.summaryError.set(
              "A summary could not be generated right now. Please try again in a minute."
            );
          }
        },
      });
  }
}
