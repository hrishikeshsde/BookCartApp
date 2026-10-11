import { AsyncPipe, CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
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
import { Store } from "@ngrx/store";
import { combineLatest, finalize, map, switchMap } from "rxjs";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { BookService } from "src/app/services/book.service";
import { getCallStateError, LoadingState } from "src/app/shared/call-state";
import { loadBooks } from "src/app/state/actions/book.actions";
import { addToCart } from "src/app/state/actions/cart.actions";
import { loadSimilarBooks } from "src/app/state/actions/similar-books.actions";
import { toggleWishlistItem } from "src/app/state/actions/wishlist.actions";
import { selectIsAuthenticated } from "src/app/state/selectors/auth.selectors";
import {
  selectBookById,
  selectBookCallState,
} from "src/app/state/selectors/book.selectors";
import {
  selectSimilarBooks,
  selectSimilarBooksCallState,
} from "src/app/state/selectors/similar-books.selectors";
import { selectWishlistItems } from "src/app/state/selectors/wishlist.selectors";
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
    AsyncPipe,
    CurrencyPipe,
  ],
})
export class BookDetailsComponent {
  private readonly store = inject(Store);
  private readonly bookService = inject(BookService);
  LoadingState = LoadingState;

  /** The :id in /books/details/:id. */
  readonly id = input.required<string>();
  private readonly bookId = computed(() => Number(this.id()));

  bookDetails$ = combineLatest([
    toObservable(this.bookId).pipe(
      switchMap((bookId) => this.store.select(selectBookById(bookId)))
    ),
    this.store.select(selectIsAuthenticated),
    this.store.select(selectBookCallState),
  ]).pipe(
    map(([book, isAuthenticated, callState]) => {
      return {
        book,
        isAuthenticated,
        callState,
        isLoading: callState === LoadingState.LOADING,
        hasError: getCallStateError(callState) !== null,
      };
    })
  );

  protected readonly similarBooks = this.store.selectSignal(selectSimilarBooks);
  private readonly similarCallState = this.store.selectSignal(
    selectSimilarBooksCallState
  );
  protected readonly similarLoading = computed(
    () => this.similarCallState() === LoadingState.LOADING
  );

  private readonly wishlist = this.store.selectSignal(selectWishlistItems);
  protected readonly wishlistedIds = computed(
    () => new Set(this.wishlist().map((book) => book.bookId))
  );

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
    this.store.dispatch(loadBooks());
    // Whenever the page shows another book, fetch the books similar to it.
    effect(() =>
      this.store.dispatch(loadSimilarBooks({ bookId: this.bookId() }))
    );
  }

  protected addToCart(bookId: number) {
    this.store.dispatch(addToCart({ bookId }));
  }

  protected toggleWishlist({ bookId, isAdd }: WishlistToggle) {
    this.store.dispatch(toggleWishlistItem({ bookId, isAdd }));
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
