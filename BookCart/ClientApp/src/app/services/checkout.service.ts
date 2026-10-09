import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class CheckoutService {
  private readonly http = inject(HttpClient);
  private readonly baseURL = "/api/checkout";

  /**
   * Places an order for everything in the server-side cart. Nothing is sent: the server prices the order from its own
   * database and cart, so a total or prices from the browser would only ever be ignored.
   */
  placeOrder() {
    return this.http.post<{ orderId: string }>(this.baseURL, {});
  }
}
