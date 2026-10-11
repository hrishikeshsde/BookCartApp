import { CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatSlider, MatSliderThumb } from "@angular/material/slider";
import { PriceRange } from "src/app/models/price-range";

/** The price slider. It is told the ends of the range and reports the price the visitor chose. */
@Component({
  selector: "app-price-filter",
  templateUrl: "./price-filter.component.html",
  styleUrls: ["./price-filter.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatSlider,
    MatSliderThumb,
    ReactiveFormsModule,
    FormsModule,
    CurrencyPipe,
  ],
})
export class PriceFilterComponent {
  /** The cheapest and dearest book; null while there are no books to filter. */
  readonly range = input<PriceRange | null>(null);
  readonly priceChange = output<number>();

  formatLabel(labelValue: number): string {
    if (labelValue >= 1000) {
      return Math.round(labelValue / 1000) + "k";
    }
    return `${labelValue}`;
  }

  onChange(event: Event) {
    this.priceChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
