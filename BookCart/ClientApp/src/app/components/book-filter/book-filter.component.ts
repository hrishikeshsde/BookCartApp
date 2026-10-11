import { LowerCasePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";
import { MatDivider } from "@angular/material/divider";
import { MatListItem, MatListModule } from "@angular/material/list";
import { RouterLink } from "@angular/router";
import { Categories } from "src/app/models/categories";

/** The category list beside the books. The current category and the categories come from the page. */
@Component({
  selector: "app-book-filter",
  templateUrl: "./book-filter.component.html",
  styleUrls: ["./book-filter.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatListModule, MatListItem, RouterLink, MatDivider, LowerCasePipe],
})
export class BookFilterComponent {
  /** The selected category, in lower case; empty for "All Categories". */
  readonly category = input("");
  readonly categories = input.required<Categories[]>();
}
