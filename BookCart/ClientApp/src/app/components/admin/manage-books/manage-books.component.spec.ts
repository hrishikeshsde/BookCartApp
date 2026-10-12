import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { provideRouter } from "@angular/router";
import { BooksStore } from "src/app/state/books/books.store";
import { fakeBooksStore } from "src/app/testing/fake-books-store";
import { aBook } from "src/app/testing/fixtures";
import { DeleteBookComponent } from "../delete-book/delete-book.component";
import { ManageBooksComponent } from "./manage-books.component";

describe("ManageBooksComponent", () => {
  let fixture: ComponentFixture<ManageBooksComponent>;
  let booksStore: ReturnType<typeof fakeBooksStore>;
  const root = () => fixture.nativeElement as HTMLElement;
  const titles = () => Array.from(root().querySelectorAll("tr.mat-mdc-row, tr[mat-row]")).map((row) => row.querySelectorAll("td")[1]?.textContent?.trim());

  beforeEach(() => {
    booksStore = fakeBooksStore([
      aBook(1, { title: "Dune", author: "Frank Herbert" }),
      aBook(2, { title: "Emma", author: "Jane Austen" }),
      aBook(3, { title: "Persuasion", author: "Jane Austen" }),
    ]);
    TestBed.configureTestingModule({
      imports: [ManageBooksComponent],
      providers: [provideRouter([]), { provide: BooksStore, useValue: booksStore }],
    });
    fixture = TestBed.createComponent(ManageBooksComponent);
    fixture.detectChanges();
  });

  it("asks for the books when the page opens (a refresh on /admin/books has none yet)", () => {
    expect(booksStore.load).toHaveBeenCalledTimes(1);
  });

  it("lists every book", () => {
    expect(titles()).toEqual(["Dune", "Emma", "Persuasion"]);
  });

  it("filters as the admin types, by any column", () => {
    const search = root().querySelector("input[placeholder=Search]") as HTMLInputElement;
    search.value = "austen";
    search.dispatchEvent(new Event("keyup"));
    fixture.detectChanges();
    expect(titles()).toEqual(["Emma", "Persuasion"]);

    search.value = "dune";
    search.dispatchEvent(new Event("keyup"));
    fixture.detectChanges();
    expect(titles()).toEqual(["Dune"]);
  });

  it("shows a book added meanwhile", () => {
    booksStore.entities.update((books) => [...books, aBook(4, { title: "Walden" })]);
    fixture.detectChanges();
    expect(titles()).toContain("Walden");
  });

  it("the delete button opens the confirmation for that book", () => {
    const open = vi.spyOn(TestBed.inject(MatDialog), "open").mockReturnValue(undefined as never);
    const deleteButton = Array.from(root().querySelectorAll("tr[mat-row]")[1].querySelectorAll("button")).find((b) => b.textContent?.includes("delete")) as HTMLButtonElement;
    deleteButton.click();
    expect(open).toHaveBeenCalledWith(DeleteBookComponent, { data: 2 });
  });
});
