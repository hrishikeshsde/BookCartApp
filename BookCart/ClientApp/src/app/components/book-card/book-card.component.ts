import { CurrencyPipe, NgOptimizedImage } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from "@angular/core";
import { MatCard, MatCardContent } from "@angular/material/card";
import { RouterLink } from "@angular/router";
import { Book } from "src/app/models/book";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { AddtocartComponent } from "../addtocart/addtocart.component";
import { AddtowishlistComponent } from "../addtowishlist/addtowishlist.component";

/** One book in a list. It shows what it is given and reports clicks; the page that lists the books acts on them. */
@Component({
  selector: "app-book-card",
  templateUrl: "./book-card.component.html",
  styleUrls: ["./book-card.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    RouterLink,
    NgOptimizedImage,
    MatCardContent,
    AddtowishlistComponent,
    AddtocartComponent,
    CurrencyPipe,
  ],
})
export class BookCardComponent {
  readonly book = input.required<Book>();
  /** True for the first row of a list: its pictures load first (the others load when they come near the screen). */
  readonly priority = input(false);
  /** Only signed-in visitors have a wishlist, so only they get the heart. */
  readonly signedIn = input(false);
  readonly wishlisted = input(false);
  readonly addToCart = output<number>();
  readonly toggleWishlist = output<WishlistToggle>();

  protected readonly isActive = signal(false);
}
