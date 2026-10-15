import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { MatButton } from "@angular/material/button";
import { MatIcon } from "@angular/material/icon";

/** The "Add to Cart" button. It only reports the click: whoever shows it decides what adding to the cart means. */
@Component({
  selector: "app-addtocart",
  templateUrl: "./addtocart.component.html",
  styleUrls: ["./addtocart.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIcon],
})
export class AddtocartComponent {
  readonly bookId = input.required<number>();
  /** The book's title, so a screen reader hears which book "Add to Cart" is for. */
  readonly bookTitle = input("");
  readonly add = output<number>();
}
