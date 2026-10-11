import { NgClass } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from "@angular/core";
import { MatButton } from "@angular/material/button";
import { WishlistToggle } from "src/app/models/wishlist-toggle";

/**
 * A heart (or a button) for adding a book to the wishlist and taking it off again. It is told whether the book is on
 * the wishlist and reports a click; it keeps no state of its own beyond showing the click at once.
 */
@Component({
  selector: "app-addtowishlist",
  templateUrl: "./addtowishlist.component.html",
  styleUrls: ["./addtowishlist.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, NgClass],
})
export class AddtowishlistComponent {
  readonly bookId = input.required<number>();
  readonly showButton = input(false);
  /** Whether the book is on the wishlist right now (the parent knows). */
  readonly wishlisted = input(false);
  readonly toggle = output<WishlistToggle>();

  // Follows the input, but flips at once on a click instead of waiting for the server's answer.
  protected readonly selected = linkedSignal(() => this.wishlisted());
  protected readonly buttonText = computed(() =>
    this.selected() ? "Remove from Wishlist" : "Add to Wishlist"
  );

  toggleValue() {
    const isAdd = !this.selected();
    this.selected.set(isAdd);
    this.toggle.emit({ bookId: this.bookId(), isAdd });
  }
}
