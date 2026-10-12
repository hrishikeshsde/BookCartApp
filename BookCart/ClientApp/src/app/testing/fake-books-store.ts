import { computed, signal } from "@angular/core";
import { Book } from "../models/book";
import { CallState } from "../shared/with-call-state";

/**
 * Stands in for BooksStore in component specs: the same signals, with the books you give it, and spies for the methods.
 * Provide it with `{ provide: BooksStore, useValue: fakeBooksStore(books) }`.
 */
export function fakeBooksStore(books: Book[] = [], initial: CallState = "loaded") {
  const entities = signal(books);
  const callState = signal<CallState>(initial);
  return {
    entities,
    entityMap: computed(() => Object.fromEntries(entities().map((book) => [book.bookId, book]))),
    priceRange: computed(() =>
      entities().length === 0
        ? undefined
        : {
            min: Math.min(...entities().map((book) => book.price)),
            max: Math.max(...entities().map((book) => book.price)),
          }
    ),
    callState,
    loading: computed(() => callState() === "loading"),
    loaded: computed(() => callState() === "loaded"),
    error: computed(() => {
      const state = callState();
      return typeof state === "object" ? state.error : null;
    }),
    load: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}
