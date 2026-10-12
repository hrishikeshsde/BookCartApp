import { inject } from "@angular/core";
import { tapResponse } from "@ngrx/operators";
import {
  patchState,
  signalStore,
  withMethods,
  withState,
} from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { exhaustMap, filter, pipe, tap } from "rxjs";
import { Categories } from "src/app/models/categories";
import { BookService } from "src/app/services/book.service";
import { errorText } from "src/app/shared/http-error";
import {
  setError,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";

/** The book categories. They are fetched once: asking again while loaded (or loading) does nothing. */
export const CategoriesStore = signalStore(
  { providedIn: "root" },
  withState<{ categories: Categories[] }>({ categories: [] }),
  withCallState(),
  withMethods((store, bookService = inject(BookService)) => ({
    load: rxMethod<void>(
      pipe(
        filter(() => !store.loaded() && !store.loading()),
        tap(() => patchState(store, setLoading())),
        exhaustMap(() =>
          bookService.getCategories().pipe(
            tapResponse({
              next: (categories) =>
                patchState(store, { categories }, setLoaded()),
              error: (error) => patchState(store, setError(errorText(error))),
            })
          )
        )
      )
    ),
  }))
);
