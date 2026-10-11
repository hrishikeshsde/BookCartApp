import { logout, sessionExpired } from "../actions/auth.actions";
import { loadOrdersSuccess } from "../actions/order.actions";
import { orderReducer } from "./order.reducers";

describe("orderReducer", () => {
  const order = { orderId: "o1", orderDetails: [], cartTotal: 10, orderDate: new Date() };

  it("keeps the orders it is given", () => {
    expect(orderReducer(undefined, loadOrdersSuccess({ orders: [order] })).orders).toEqual([order]);
  });

  it("forgets them when the person logs out or the session ends (they are private to that person)", () => {
    const loaded = orderReducer(undefined, loadOrdersSuccess({ orders: [order] }));
    expect(orderReducer(loaded, logout()).orders).toEqual([]);
    expect(orderReducer(loaded, sessionExpired({ hadSession: true })).orders).toEqual([]);
  });
});
