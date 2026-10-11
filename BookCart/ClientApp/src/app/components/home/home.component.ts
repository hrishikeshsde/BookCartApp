import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
} from "@angular/core";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { Store } from "@ngrx/store";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { LoadingState } from "src/app/shared/call-state";
import {
  loadBooks,
  resetSearchItemValue,
  setSearchItemValue,
} from "src/app/state/actions/book.actions";
import { addToCart } from "src/app/state/actions/cart.actions";
import { loadCategories } from "src/app/state/actions/categories.actions";
import { toggleWishlistItem } from "src/app/state/actions/wishlist.actions";
import { selectIsAuthenticated } from "src/app/state/selectors/auth.selectors";
import {
  selectBookCallState,
  selectBooks,
  selectMaxBookPrice,
  selectMinBookPrice,
} from "src/app/state/selectors/book.selectors";
import { selectCategories } from "src/app/state/selectors/categories.selectors";
import { selectWishlistItems } from "src/app/state/selectors/wishlist.selectors";
import { BookCardComponent } from "../book-card/book-card.component";
import { BookFilterComponent } from "../book-filter/book-filter.component";
import { PriceFilterComponent } from "../price-filter/price-filter.component";

/** The catalogue page: it owns the filters (category, search text, price) and the store, its children only draw. */
@Component({
  selector: "app-home",
  templateUrl: "./home.component.html",
  styleUrls: ["./home.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BookFilterComponent,
    PriceFilterComponent,
    BookCardComponent,
    MatProgressSpinner,
  ],
})
export class HomeComponent implements OnDestroy {
  private readonly store = inject(Store);

  /** ?category= (lower case), set by the category list. */
  readonly category = input<string>();
  /** ?item= (lower case), set by the search box. */
  readonly item = input<string>();

  private readonly books = this.store.selectSignal(selectBooks);
  private readonly bookCallState = this.store.selectSignal(selectBookCallState);
  private readonly minPrice = this.store.selectSignal(selectMinBookPrice);
  private readonly maxPrice = this.store.selectSignal(selectMaxBookPrice);
  private readonly wishlist = this.store.selectSignal(selectWishlistItems);
  protected readonly categories = this.store.selectSignal(selectCategories);
  protected readonly signedIn = this.store.selectSignal(selectIsAuthenticated);

  /** The most a visitor wants to pay: the price slider moves it. */
  protected readonly priceFilter = signal(Number.MAX_SAFE_INTEGER);

  protected readonly priceRange = computed(() =>
    this.books().length > 0
      ? { minPrice: this.minPrice() ?? 0, maxPrice: this.maxPrice() ?? 0 }
      : null
  );

  protected readonly wishlistedIds = computed(
    () => new Set(this.wishlist().map((book) => book.bookId))
  );

  protected readonly visibleBooks = computed(() => {
    const category = this.category()?.toLocaleLowerCase();
    const searchItem = this.item()?.toLocaleLowerCase();
    const maxPrice = this.priceFilter();
    return this.books().filter(
      (book) =>
        (!category || book.category.toLocaleLowerCase() === category) &&
        (!searchItem ||
          book.title.toLocaleLowerCase().includes(searchItem) ||
          book.author.toLocaleLowerCase().includes(searchItem)) &&
        book.price <= maxPrice
    );
  });

  /** True while the first load of the catalogue is under way (a reload of books already shown does not blank the page). */
  protected readonly firstLoad = computed(
    () =>
      this.books().length === 0 &&
      (this.bookCallState() === LoadingState.LOADING ||
        this.bookCallState() === LoadingState.INIT)
  );

  constructor() {
    this.store.dispatch(loadBooks());
    this.store.dispatch(loadCategories());

    // The search box shows the search text held in the store: keep it in step with the address.
    effect(() =>
      this.store.dispatch(setSearchItemValue({ searchItem: this.item() ?? "" }))
    );
  }

  protected addToCart(bookId: number) {
    this.store.dispatch(addToCart({ bookId }));
  }

  protected toggleWishlist({ bookId, isAdd }: WishlistToggle) {
    this.store.dispatch(toggleWishlistItem({ bookId, isAdd }));
  }

  ngOnDestroy() {
    this.store.dispatch(resetSearchItemValue());
  }
}
