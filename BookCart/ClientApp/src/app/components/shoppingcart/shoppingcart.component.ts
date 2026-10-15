import { CurrencyPipe, NgOptimizedImage } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
} from "@angular/core";
import { MatButton, MatIconButton } from "@angular/material/button";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatIcon } from "@angular/material/icon";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { RouterLink } from "@angular/router";
import { CartStore } from "src/app/state/cart/cart.store";

@Component({
  selector: "app-shoppingcart",
  templateUrl: "./shoppingcart.component.html",
  styleUrls: ["./shoppingcart.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinner,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatButton,
    MatIconButton,
    MatIcon,
    RouterLink,
    NgOptimizedImage,
    CurrencyPipe,
  ],
})
export class ShoppingcartComponent implements OnInit {
  private readonly cart = inject(CartStore);

  protected readonly cartItems = computed(() => ({
    items: this.cart.items(),
    total: this.cart.total(),
    loading: this.cart.loading(),
  }));

  ngOnInit() {
    this.cart.load();
  }

  deleteCartItem(bookId: number) {
    this.cart.remove(bookId);
  }

  addBookToCart(bookId: number) {
    this.cart.add(bookId);
  }

  deleteOneCartItem(bookId: number) {
    this.cart.reduce(bookId);
  }

  clearCart() {
    this.cart.clear();
  }
}
