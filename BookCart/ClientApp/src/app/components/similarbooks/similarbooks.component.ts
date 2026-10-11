import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { Book } from "src/app/models/book";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { BookCardComponent } from "../book-card/book-card.component";

/** The "Similar Books" panel of the details page: a list of cards that passes their clicks on. */
@Component({
  selector: "app-similarbooks",
  templateUrl: "./similarbooks.component.html",
  styleUrls: ["./similarbooks.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    BookCardComponent,
    MatProgressSpinner,
  ],
})
export class SimilarbooksComponent {
  readonly books = input.required<Book[]>();
  readonly loading = input(false);
  readonly signedIn = input(false);
  /** The ids of the books on the wishlist, to tick the hearts. */
  readonly wishlistedIds = input<ReadonlySet<number>>(new Set());
  readonly addToCart = output<number>();
  readonly toggleWishlist = output<WishlistToggle>();
}
