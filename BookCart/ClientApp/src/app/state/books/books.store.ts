import { computed, inject } from "@angular/core";
import { Router } from "@angular/router";
import { tapResponse } from "@ngrx/operators";
import {
  patchState,
  signalStore,
  type,
  withComputed,
  withMethods,
} from "@ngrx/signals";
import {
  addEntity,
  entityConfig,
  removeEntity,
  setAllEntities,
  updateEntity,
  withEntities,
} from "@ngrx/signals/entities";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { concatMap, exhaustMap, filter, pipe, tap } from "rxjs";
import { Book } from "src/app/models/book";
import { BookService } from "src/app/services/book.service";
import { SnackbarService } from "src/app/services/snackbar.service";
import { errorText } from "src/app/shared/http-error";
import {
  setError,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";

const bookConfig = entityConfig({
  entity: type<Book>(),
  selectId: (book) => book.bookId,
});

/**
 * The catalogue. It is fetched once and kept: the admin's add, update and delete change the list in place, so nothing
 * refetches it. `callState` is about fetching the list only; a failed add, update or delete shows a message instead.
 */
export const BooksStore = signalStore(
  { providedIn: "root" },
  withEntities(bookConfig),
  withCallState(),
  withComputed(({ entities }) => ({
    /** The cheapest and the dearest book (undefined while there are none). One pass, no spread into Math.min. */
    priceRange: computed(() =>
      entities().reduce<{ min: number; max: number } | undefined>(
        (range, { price }) =>
          range
            ? { min: Math.min(range.min, price), max: Math.max(range.max, price) }
            : { min: price, max: price },
        undefined
      )
    ),
  })),
  withMethods(
    (
      store,
      bookService = inject(BookService),
      snackbar = inject(SnackbarService),
      router = inject(Router)
    ) => {
      const showFailure = (what: string, error: unknown) => {
        snackbar.showSnackBar("Error occurred: Please try again");
        console.error(`Error occurred while ${what}:`, errorText(error));
      };
      const backToAdminPanel = () => router.navigate(["/admin/books"]);

      return {
        /** Fetches the books unless they are already here (or on their way). */
        load: rxMethod<void>(
          pipe(
            filter(() => !store.loaded() && !store.loading()),
            tap(() => patchState(store, setLoading())),
            exhaustMap(() =>
              bookService.getAllBooks().pipe(
                tapResponse({
                  next: (books) =>
                    patchState(
                      store,
                      setAllEntities(books, bookConfig),
                      setLoaded()
                    ),
                  error: (error) =>
                    patchState(store, setError(errorText(error))),
                })
              )
            )
          )
        ),

        /** `book` is the admin form: one field per book property and an optional cover file. */
        add: rxMethod<FormData>(
          exhaustMap((book) =>
            bookService.addBook(book).pipe(
              tapResponse({
                next: (saved) => {
                  patchState(store, addEntity(saved, bookConfig));
                  snackbar.showSnackBar("Book added successfully");
                  backToAdminPanel();
                },
                error: (error) => showFailure("adding a book", error),
              })
            )
          )
        ),

        update: rxMethod<FormData>(
          exhaustMap((book) =>
            bookService.updateBookDetails(book).pipe(
              tapResponse({
                next: (saved) => {
                  patchState(
                    store,
                    updateEntity({ id: saved.bookId, changes: saved }, bookConfig)
                  );
                  snackbar.showSnackBar("Book updated successfully");
                  backToAdminPanel();
                },
                error: (error) => showFailure("updating a book", error),
              })
            )
          )
        ),

        remove: rxMethod<number>(
          concatMap((bookId) =>
            bookService.deleteBook(bookId).pipe(
              tapResponse({
                next: () => {
                  patchState(store, removeEntity(bookId));
                  snackbar.showSnackBar("Book deleted successfully");
                },
                error: (error) => showFailure("deleting a book", error),
              })
            )
          )
        ),
      };
    }
  )
);
