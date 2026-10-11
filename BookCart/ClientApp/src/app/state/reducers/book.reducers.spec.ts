import { aBook } from "src/app/testing/fixtures";
import {
  addBookSuccess,
  deleteBookSuccess,
  loadBooksFailure,
  loadBooksSuccess,
  resetSearchItemValue,
  setSearchItemValue,
  updateBookSuccess,
} from "../actions/book.actions";
import { bookAdapter, bookReducer } from "./book.reducers";

const all = (state: ReturnType<typeof bookReducer>) => bookAdapter.getSelectors().selectAll(state);

describe("bookReducer", () => {
  it("replaces the catalogue when it loads", () => {
    const first = bookReducer(undefined, loadBooksSuccess({ books: [aBook(1), aBook(2)] }));
    const second = bookReducer(first, loadBooksSuccess({ books: [aBook(3)] }));
    expect(all(second).map((b) => b.bookId)).toEqual([3]);
  });

  it("applies an add, an update and a delete itself (no refetch needed)", () => {
    let state = bookReducer(undefined, loadBooksSuccess({ books: [aBook(1), aBook(2)] }));

    state = bookReducer(state, addBookSuccess({ book: aBook(3) }));
    expect(all(state).map((b) => b.bookId)).toEqual([1, 2, 3]);

    state = bookReducer(state, updateBookSuccess({ book: aBook(2, { title: "Renamed", price: 999 }) }));
    expect(all(state).find((b) => b.bookId === 2)).toEqual(aBook(2, { title: "Renamed", price: 999 }));

    state = bookReducer(state, deleteBookSuccess({ bookId: 1 }));
    expect(all(state).map((b) => b.bookId)).toEqual([2, 3]);
  });

  it("keeps the books on a failed load", () => {
    const loaded = bookReducer(undefined, loadBooksSuccess({ books: [aBook(1)] }));
    const state = bookReducer(loaded, loadBooksFailure({ errorMessage: "down" }));
    expect(all(state).length).toBe(1);
    expect(state.bookCallState).toEqual({ errorMessage: "down" });
  });

  it("remembers and forgets the search text", () => {
    const state = bookReducer(undefined, setSearchItemValue({ searchItem: "dune" }));
    expect(state.searchItem).toBe("dune");
    expect(bookReducer(state, resetSearchItemValue()).searchItem).toBe("");
  });
});
