import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { CustomerOrder } from "../models/order";

@Injectable({
  providedIn: "root",
})
export class MyordersService {
  private readonly http = inject(HttpClient);
  private readonly baseURL = "/api/order";

  /** The signed-in user's own orders: the server knows who that is from the token. */
  myOrderDetails() {
    return this.http.get<CustomerOrder[]>(this.baseURL);
  }
}
