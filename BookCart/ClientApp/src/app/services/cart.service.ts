import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { ShoppingCart } from "../models/shoppingcart";

/**
 * The server decides whose cart this is: the signed-in user's, or else the anonymous visitor's (identified by a cookie
 * the server sets when the first book is added). There is no user id in any URL.
 */
@Injectable({
  providedIn: "root",
})
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly baseURL = "/api/shoppingcart";

  getCartItems() {
    return this.http.get<ShoppingCart[]>(this.baseURL);
  }

  addBookToCart(bookId: number) {
    return this.http.post<ShoppingCart[]>(`${this.baseURL}/items/${bookId}`, {});
  }

  // Delete a single item from the cart
  removeBookFromCart(bookId: number) {
    return this.http.delete<ShoppingCart[]>(`${this.baseURL}/items/${bookId}`);
  }

  // Reduces the quantity by one for an item in shopping cart
  reduceCartQuantity(bookId: number) {
    return this.http.patch<ShoppingCart[]>(`${this.baseURL}/items/${bookId}`, {});
  }

  clearCart() {
    return this.http.delete<void>(this.baseURL);
  }
}
