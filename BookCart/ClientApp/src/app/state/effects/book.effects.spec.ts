import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { provideMockActions } from "@ngrx/effects/testing";
import { Action } from "@ngrx/store";
import { Subject } from "rxjs";
import { SnackbarService } from "src/app/services/snackbar.service";
import { aBook } from "src/app/testing/fixtures";
import { collect, SnackbarStub } from "src/app/testing/helpers";
import {
  addBook,
  addBookSuccess,
  deleteBook,
  deleteBookSuccess,
  loadBooks,
  loadBooksFailure,
  loadBooksSuccess,
  updateBookSuccess,
} from "../actions/book.actions";
import { BookEffects } from "./book.effects";

describe("BookEffects", () => {
  let actions$: Subject<Action>;
  let effects: BookEffects;
  let http: HttpTestingController;
  let snackbar: SnackbarStub;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    actions$ = new Subject<Action>();
    snackbar = new SnackbarStub();
    TestBed.configureTestingModule({
      providers: [
        BookEffects,
        provideMockActions(() => actions$),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SnackbarService, useValue: snackbar },
      ],
    });
    effects = TestBed.inject(BookEffects);
    http = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), "navigate").and.resolveTo(true);
  });
  afterEach(() => http.verify());

  it("loads the catalogue", () => {
    const out = collect(effects.loadBooks$);
    actions$.next(loadBooks());
    http.expectOne("/api/book").flush([aBook(1), aBook(2)]);
    expect(out).toEqual([loadBooksSuccess({ books: [aBook(1), aBook(2)] })]);
  });

  it("reports a failed load as text, not as an error object", () => {
    const out = collect(effects.loadBooks$);
    actions$.next(loadBooks());
    http.expectOne("/api/book").flush({ title: "Service Unavailable" }, { status: 503, statusText: "Service Unavailable" });
    expect(out).toEqual([loadBooksFailure({ errorMessage: "Service Unavailable" })]);
  });

  it("does not fetch the whole list again after an add, update or delete (the reducer applies them)", () => {
    effects.loadBooks$.subscribe();
    actions$.next(addBookSuccess({ book: aBook(3) }));
    actions$.next(updateBookSuccess({ book: aBook(3) }));
    actions$.next(deleteBookSuccess({ bookId: 3 }));
    http.expectNone("/api/book");
  });

  it("adding a book posts the form, confirms and returns to the admin list", () => {
    const form = new FormData();
    const out = collect(effects.addBook$);
    actions$.next(addBook({ book: form }));
    const request = http.expectOne("/api/book");
    expect(request.request.method).toBe("POST");
    expect(request.request.body).toBe(form);
    request.flush(aBook(9), { status: 201, statusText: "Created" });

    expect(out).toEqual([addBookSuccess({ book: aBook(9) })]);
    expect(snackbar.messages).toEqual(["Book added successfully"]);
    expect(navigate).toHaveBeenCalledWith(["/admin/books"]);
  });

  it("deleting a book calls the API with its id", () => {
    const out = collect(effects.deleteBook$);
    actions$.next(deleteBook({ bookId: 4 }));
    const request = http.expectOne("/api/book/4");
    expect(request.request.method).toBe("DELETE");
    request.flush(null, { status: 204, statusText: "No Content" });
    expect(out).toEqual([deleteBookSuccess({ bookId: 4 })]);
  });
});
