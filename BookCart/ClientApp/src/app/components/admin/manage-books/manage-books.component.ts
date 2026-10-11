import { CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  computed,
  signal,
  viewChild,
} from "@angular/core";
import { MatButton, MatIconButton } from "@angular/material/button";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatDialog } from "@angular/material/dialog";
import { MatFormField, MatLabel } from "@angular/material/form-field";
import { MatIcon } from "@angular/material/icon";
import { MatInput } from "@angular/material/input";
import { MatPaginator } from "@angular/material/paginator";
import { MatSort, MatSortHeader } from "@angular/material/sort";
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatNoDataRow,
  MatRow,
  MatRowDef,
  MatTable,
  MatTableDataSource,
} from "@angular/material/table";
import { RouterLink } from "@angular/router";
import { Store } from "@ngrx/store";
import { loadBooks } from "src/app/state/actions/book.actions";
import { selectBooks } from "src/app/state/selectors/book.selectors";
import { DeleteBookComponent } from "../delete-book/delete-book.component";

@Component({
    selector: "app-manage-books",
    templateUrl: "./manage-books.component.html",
    styleUrls: ["./manage-books.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatCard,
        MatCardHeader,
        MatCardTitle,
        MatButton,
        RouterLink,
        MatCardContent,
        MatFormField,
        MatLabel,
        MatInput,
        MatTable,
        MatSort,
        MatColumnDef,
        MatHeaderCellDef,
        MatHeaderCell,
        MatSortHeader,
        MatCellDef,
        MatCell,
        MatIconButton,
        MatIcon,
        MatHeaderRowDef,
        MatHeaderRow,
        MatRowDef,
        MatRow,
        MatNoDataRow,
        MatPaginator,
        CurrencyPipe,
    ]
})
export class ManageBooksComponent {
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(Store);

  private readonly paginator = viewChild(MatPaginator);
  private readonly sort = viewChild(MatSort);

  protected readonly searchValue = signal("");
  private readonly books = this.store.selectSignal(selectBooks);

  // Rebuilt when the books, the search text or (once the table is on screen) the paginator and sorter change.
  protected readonly bookTableData = computed(() => {
    const dataSource = new MatTableDataSource(this.books());
    dataSource.paginator = this.paginator() ?? null;
    dataSource.sort = this.sort() ?? null;
    const searchValue = this.searchValue();
    if (searchValue.length > 0) {
      dataSource.filter = searchValue.trim().toLowerCase();
      dataSource.paginator?.firstPage();
    }
    return dataSource;
  });

  displayedColumns: string[] = [
    "id",
    "title",
    "author",
    "category",
    "price",
    "operation",
  ];

  constructor() {
    this.store.dispatch(loadBooks());
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchValue.set(filterValue);
  }

  deleteConfirm(bookId: number): void {
    this.dialog.open(DeleteBookComponent, {
      data: bookId,
    });
  }
}
