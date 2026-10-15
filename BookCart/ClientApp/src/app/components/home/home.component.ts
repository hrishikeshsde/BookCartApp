import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from "@angular/core";
import { MatPaginator, PageEvent } from "@angular/material/paginator";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { BooksStore } from "src/app/state/books/books.store";
import { AuthStore } from "src/app/state/auth/auth.store";
import { CartStore } from "src/app/state/cart/cart.store";
import { CategoriesStore } from "src/app/state/categories/categories.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
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
    MatPaginator,
  ],
})
export class HomeComponent {
  private readonly booksStore = inject(BooksStore);
  private readonly categoriesStore = inject(CategoriesStore);
  private readonly cart = inject(CartStore);
  private readonly wishlist = inject(WishlistStore);

  /** ?category= (lower case), set by the category list. */
  readonly category = input<string>();
  /** ?item= (lower case), set by the search box. */
  readonly item = input<string>();

  private readonly books = this.booksStore.entities;
  protected readonly categories = this.categoriesStore.categories;
  protected readonly signedIn = inject(AuthStore).isAuthenticated;

  /** The most a visitor wants to pay: the price slider moves it. */
  protected readonly priceFilter = signal(Number.MAX_SAFE_INTEGER);

  protected readonly priceRange = computed(() => {
    const range = this.booksStore.priceRange();
    return range ? { minPrice: range.min, maxPrice: range.max } : null;
  });

  protected readonly wishlistedIds = this.wishlist.ids;

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

  /** How many books a page of the grid holds (the paginator offers these). */
  protected readonly pageSizes = [12, 24, 48];
  protected readonly pageSize = signal(this.pageSizes[0]);
  /** Back on the first page whenever the filters change what is listed. */
  protected readonly pageIndex = linkedSignal<number, number>({
    source: () => this.visibleBooks().length,
    computation: () => 0,
  });
  protected readonly pagedBooks = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.visibleBooks().slice(start, start + this.pageSize());
  });

  /** True while the first load of the catalogue is under way (a reload of books already shown does not blank the page). */
  protected readonly firstLoad = computed(
    () =>
      this.books().length === 0 &&
      (this.booksStore.loading() || this.booksStore.callState() === "init")
  );

  constructor() {
    this.booksStore.load();
    this.categoriesStore.load();
  }

  protected onPage({ pageIndex, pageSize }: PageEvent) {
    this.pageSize.set(pageSize);
    this.pageIndex.set(pageIndex);
  }

  protected addToCart(bookId: number) {
    this.cart.add(bookId);
  }

  protected toggleWishlist({ bookId, isAdd }: WishlistToggle) {
    this.wishlist.toggle({ bookId, isAdd });
  }
}
