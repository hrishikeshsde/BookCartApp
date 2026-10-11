import { aBook, aCartItem, aUser } from "src/app/testing/fixtures";
import { selectIsAdmin } from "./auth.selectors";
import { selectCurrentBookDetails, selectMaxBookPrice, selectMinBookPrice, selectSearchItemValue, } from "./book.selectors";
import { selectCarttemsCount } from "./cart.selectors";
import { selectWishlistItemsCount } from "./wishlist.selectors";

describe("selectors", () => {
  it("the price range is the cheapest and the dearest book", () => {
    const books = [aBook(1, { price: 250 }), aBook(2, { price: 40 }), aBook(3, { price: 900 })];
    expect(selectMinBookPrice.projector(books)).toBe(40);
    expect(selectMaxBookPrice.projector(books)).toBe(900);
  });

  it("the current book is looked up by the id in the address", () => {
    const entities = { 2: aBook(2) };
    expect(selectCurrentBookDetails.projector(entities, "2")).toEqual(aBook(2));
    expect(selectCurrentBookDetails.projector(entities, "9")).toBeUndefined();
    expect(selectCurrentBookDetails.projector(entities, undefined)).toBeUndefined();
  });

  it("the search text defaults to empty", () => {
    expect(selectSearchItemValue.projector({ searchItem: undefined } as never)).toBe("");
    expect(selectSearchItemValue.projector({ searchItem: "dune" } as never)).toBe("dune");
  });

  it("the cart badge counts copies, not lines", () => {
    const state = { shoppingCart: [aCartItem(1, 2), aCartItem(2, 3)], cartCallState: "LOADED" };
    expect(selectCarttemsCount.projector(state as never)).toBe(5);
  });

  it("the wishlist badge counts books", () => {
    expect(selectWishlistItemsCount.projector({ wishlist: [aBook(1), aBook(2)] } as never)).toBe(2);
  });

  it("admin means the Admin role, nothing else", () => {
    expect(selectIsAdmin.projector(aUser({ userTypeName: "Admin" }))).toBe(true);
    expect(selectIsAdmin.projector(aUser({ userTypeName: "User" }))).toBe(false);
    expect(selectIsAdmin.projector(null)).toBe(false);
  });
});
