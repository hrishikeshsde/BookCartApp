import { CurrencyPipe, DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { MatButton } from "@angular/material/button";
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatFormField, MatLabel } from "@angular/material/form-field";
import { MatInput } from "@angular/material/input";
import { MatPaginator } from "@angular/material/paginator";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
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
import { CustomerOrder } from "src/app/models/order";
import { OrdersStore } from "src/app/state/orders/orders.store";

@Component({
  selector: "app-my-orders",
  templateUrl: "./my-orders.component.html",
  styleUrls: ["./my-orders.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatFormField,
    MatLabel,
    MatInput,
    MatTable,
    MatColumnDef,
    MatHeaderCellDef,
    MatHeaderCell,
    MatCellDef,
    MatCell,
    RouterLink,
    MatHeaderRowDef,
    MatHeaderRow,
    MatRowDef,
    MatRow,
    MatNoDataRow,
    MatPaginator,
    MatProgressSpinner,
    MatButton,
    CurrencyPipe,
    DatePipe,
  ],
})
export class MyOrdersComponent {
  private readonly paginator = viewChild(MatPaginator);

  private readonly ordersStore = inject(OrdersStore);

  displayedColumns: string[] = ["orderId", "orderDate", "cartTotal"];
  /** The order whose books are showing (only one at a time). */
  protected readonly expandedElement = signal<CustomerOrder | null>(null);

  protected readonly searchValue = signal("");
  private readonly orders = this.ordersStore.orders;

  protected readonly orderTableData = computed(() => {
    const dataSource = new MatTableDataSource(this.orders());

    // Set up custom filter predicate for searching orders
    dataSource.filterPredicate = (data: CustomerOrder, filter: string) => {
      const transformedFilter = filter.trim().toLowerCase();
      // orderDate arrives from the API as an ISO string even though the model calls it a Date.
      return (
        data.orderId.toLowerCase().includes(transformedFilter) ||
        String(data.orderDate).toLowerCase().includes(transformedFilter) ||
        String(data.cartTotal).toLowerCase().includes(transformedFilter)
      );
    };

    const searchValue = this.searchValue();
    dataSource.filter = searchValue.length > 0 ? searchValue.trim().toLowerCase() : "";

    // The paginator exists once the table is on screen; the table is rebuilt then.
    const paginator = this.paginator();
    if (paginator) {
      dataSource.paginator = paginator;
      // Back to the first page when a filter is applied
      if (dataSource.filter) {
        paginator.firstPage();
      }
    }
    return { dataSource, loading: this.ordersStore.loading() };
  });

  protected toggleOrder(order: CustomerOrder) {
    this.expandedElement.update((open) => (open === order ? null : order));
  }

  constructor() {
    this.ordersStore.load();
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchValue.set(filterValue);
  }
}
