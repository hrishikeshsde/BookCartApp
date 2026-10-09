import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { Book } from "../models/book";

/** The signed-in user's wishlist. The server knows who that is from the token, so there is no user id in any URL. */
@Injectable({
  providedIn: "root",
})
export class WishlistService {
  private readonly http = inject(HttpClient);
  private readonly baseURL = "/api/wishlist";

  toggleWishlistItem(bookId: number) {
    return this.http.post<Book[]>(`${this.baseURL}/items/${bookId}`, {});
  }

  getWishlistItems() {
    return this.http.get<Book[]>(this.baseURL);
  }

  clearWishlist() {
    return this.http.delete<void>(this.baseURL);
  }
}
