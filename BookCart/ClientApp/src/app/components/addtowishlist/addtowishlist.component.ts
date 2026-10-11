import { NgClass } from "@angular/common";
import { Component, inject, Input, OnChanges } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { MatButton } from "@angular/material/button";
import { Store } from "@ngrx/store";
import { Book } from "src/app/models/book";
import { toggleWishlistItem } from "src/app/state/actions/wishlist.actions";
import { selectWishlistItems } from "src/app/state/selectors/wishlist.selectors";

@Component({
    selector: "app-addtowishlist",
    templateUrl: "./addtowishlist.component.html",
    styleUrls: ["./addtowishlist.component.scss"],
    imports: [MatButton, NgClass]
})
export class AddtowishlistComponent implements OnChanges {
  @Input({ required: true })
  bookId!: number;

  @Input()
  showButton = false;

  private readonly store = inject(Store);

  toggle = false;
  buttonText = "Add to Wishlist";
  private wishlist: Book[] = [];

  constructor() {
    // One subscription for the life of the component (it used to open a new one on every input change).
    this.store
      .select(selectWishlistItems)
      .pipe(takeUntilDestroyed())
      .subscribe((items) => {
        this.wishlist = items;
        this.refresh();
      });
  }

  ngOnChanges() {
    this.refresh();
  }

  private refresh() {
    this.toggle = this.wishlist.some((book) => book.bookId === this.bookId);
    this.buttonText = this.toggle ? "Remove from Wishlist" : "Add to Wishlist";
  }

  toggleValue() {
    this.toggle = !this.toggle;
    this.buttonText = this.toggle ? "Remove from Wishlist" : "Add to Wishlist";

    this.store.dispatch(
      toggleWishlistItem({
        bookId: this.bookId,
        isAdd: this.toggle,
      })
    );
  }
}
