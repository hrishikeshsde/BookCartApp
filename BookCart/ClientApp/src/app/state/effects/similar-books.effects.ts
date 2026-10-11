import { inject, Injectable } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap } from "rxjs";
import { BookService } from "src/app/services/book.service";
import { errorText } from "src/app/shared/http-error";
import {
  loadSimilarBooks,
  loadSimilarBooksFailure,
  loadSimilarBooksSuccess,
} from "../actions/similar-books.actions";

@Injectable()
export class SimilarBooksEffects {
  private readonly actions$ = inject(Actions);
  private readonly bookService = inject(BookService);

  // switchMap: moving on to another book cancels the request for the previous one.
  loadSimilarBooks$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadSimilarBooks),
      switchMap(({ bookId }) =>
        this.bookService.getSimilarBooks(bookId).pipe(
          map((books) => loadSimilarBooksSuccess({ books })),
          catchError((error) =>
            of(loadSimilarBooksFailure({ errorMessage: errorText(error) }))
          )
        )
      )
    )
  );
}
