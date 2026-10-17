import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  isDevMode,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { MatBadge } from "@angular/material/badge";
import { MatButton, MatIconButton } from "@angular/material/button";
import { MatDivider } from "@angular/material/divider";
import { MatIcon } from "@angular/material/icon";
import { MatMenu, MatMenuItem, MatMenuTrigger } from "@angular/material/menu";
import { MatToolbar } from "@angular/material/toolbar";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
} from "@angular/router";
import { filter, map, startWith } from "rxjs";
import { AuthStore } from "src/app/state/auth/auth.store";
import { BooksStore } from "src/app/state/books/books.store";
import { CartStore } from "src/app/state/cart/cart.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
import { SearchComponent } from "../search/search.component";

@Component({
  selector: "app-nav-bar",
  templateUrl: "./nav-bar.component.html",
  styleUrls: ["./nav-bar.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatToolbar,
    MatButton,
    MatIconButton,
    MatIcon,
    MatBadge,
    MatDivider,
    MatMenuTrigger,
    MatMenu,
    MatMenuItem,
    RouterLink,
    RouterLinkActive,
    SearchComponent,
  ],
})
export class NavBarComponent {
  private readonly auth = inject(AuthStore);
  private readonly cart = inject(CartStore);
  private readonly wishlist = inject(WishlistStore);
  private readonly router = inject(Router);
  private readonly booksStore = inject(BooksStore);

  /** The backend serves its API reference (/scalar) in Development only, so only dev builds link to it. */
  protected readonly showApiDocs = isDevMode();

  protected readonly userState = computed(() => ({
    isAuthenticated: this.auth.isAuthenticated(),
    isAdmin: this.auth.isAdmin(),
    user: this.auth.user(),
    wishlistItemcount: this.wishlist.count(),
    cartItemCount: this.cart.count(),
  }));

  protected readonly books = this.booksStore.entities;
  /** What the search results page is searching for (the ?item= of /search), or nothing on any other page. */
  protected readonly searchText = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.searchTextOf(this.router.url))
    ),
    { initialValue: this.searchTextOf(this.router.url) }
  );

  private searchTextOf(url: string): string {
    const tree = this.router.parseUrl(url);
    const onSearchPage =
      tree.root.children["primary"]?.segments[0]?.path === "search";
    return onSearchPage ? (tree.queryParams["item"] ?? "") : "";
  }

  searchFor(item: string) {
    this.router.navigate(["/search"], { queryParams: { item } });
  }

  showAllBooks() {
    this.router.navigate(["/"]);
  }

  logout() {
    this.auth.logout();
  }
}
