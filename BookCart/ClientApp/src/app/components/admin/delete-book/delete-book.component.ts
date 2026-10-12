import { CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { MatButton } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from "@angular/material/dialog";
import { BooksStore } from "src/app/state/books/books.store";

@Component({
    selector: "app-delete-book",
    templateUrl: "./delete-book.component.html",
    styleUrls: ["./delete-book.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatDialogTitle,
        MatDialogContent,
        MatDialogActions,
        MatButton,
        MatDialogClose,
        CurrencyPipe,
    ]
})
export class DeleteBookComponent {
  private readonly dialogRef = inject(MatDialogRef<DeleteBookComponent>);
  private readonly bookid = inject<number>(MAT_DIALOG_DATA);
  private readonly booksStore = inject(BooksStore);

  protected readonly bookData = computed(
    () => this.booksStore.entityMap()[this.bookid]
  );

  onNoClick(): void {
    this.dialogRef.close();
  }

  confirmDelete(): void {
    this.booksStore.remove(this.bookid);
  }
}
