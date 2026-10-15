import { CurrencyPipe, NgOptimizedImage } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
} from "@angular/core";
import { MatButton } from "@angular/material/button";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { RouterLink } from "@angular/router";
import { WishlistToggle } from "src/app/models/wishlist-toggle";
import { CartStore } from "src/app/state/cart/cart.store";
import { WishlistStore } from "src/app/state/wishlist/wishlist.store";
import { AddtocartComponent } from "../addtocart/addtocart.component";
import { AddtowishlistComponent } from "../addtowishlist/addtowishlist.component";

@Component({
  selector: "app-wishlist",
  templateUrl: "./wishlist.component.html",
  styleUrls: ["./wishlist.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinner,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButton,
    RouterLink,
    NgOptimizedImage,
    AddtocartComponent,
    AddtowishlistComponent,
    CurrencyPipe,
  ],
})
export class WishlistComponent implements OnInit {
  private readonly wishlist = inject(WishlistStore);
  private readonly cart = inject(CartStore);

  protected readonly wishlistItems = computed(() => ({
    items: this.wishlist.items(),
    loading: this.wishlist.loading(),
  }));

  ngOnInit(): void {
    this.wishlist.load();
  }

  clearWishlist() {
    this.wishlist.clear();
  }

  addToCart(bookId: number) {
    this.cart.add(bookId);
  }

  toggleWishlist({ bookId, isAdd }: WishlistToggle) {
    this.wishlist.toggle({ bookId, isAdd });
  }
}
