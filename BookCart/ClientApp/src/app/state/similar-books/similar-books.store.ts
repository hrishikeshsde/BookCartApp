import { inject } from "@angular/core";
import { tapResponse } from "@ngrx/operators";
import {
  patchState,
  signalStore,
  withMethods,
  withState,
} from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { pipe, switchMap, tap } from "rxjs";
import { Book } from "src/app/models/book";
import { BookService } from "src/app/services/book.service";
import { errorText } from "src/app/shared/http-error";
import {
  setError,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";

/** The books similar to the one a page shows. Moving on to another book cancels the request for the previous one. */
export const SimilarBooksStore = signalStore(
  { providedIn: "root" },
  withState<{ books: Book[] }>({ books: [] }),
  withCallState(),
  withMethods((store, bookService = inject(BookService)) => ({
    /** Pass a book id, or a signal of one to follow it. */
    load: rxMethod<number>(
      pipe(
        tap(() => patchState(store, setLoading())),
        switchMap((bookId) =>
          bookService.getSimilarBooks(bookId).pipe(
            tapResponse({
              next: (books) => patchState(store, { books }, setLoaded()),
              error: (error) => patchState(store, setError(errorText(error))),
            })
          )
        )
      )
    ),
  }))
);
