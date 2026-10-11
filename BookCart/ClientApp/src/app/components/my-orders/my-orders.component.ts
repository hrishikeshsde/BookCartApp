import { AsyncPipe, CurrencyPipe, DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  ViewChild,
  AfterViewInit,
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
import { Store } from "@ngrx/store";
import { BehaviorSubject, combineLatest } from "rxjs";
import { map } from "rxjs/operators";
import { LoadingState } from "src/app/shared/call-state";
import { CustomerOrder } from "src/app/models/order";
import { loadOrders } from "src/app/state/actions/order.actions";
import {
  selectOrderCallState,
  selectOrderItems,
} from "src/app/state/selectors/order.selectors";

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
    AsyncPipe,
  ],
})
export class MyOrdersComponent implements AfterViewInit {
  @ViewChild(MatPaginator)
  paginator!: MatPaginator;

  private readonly store = inject(Store);
  loadingState = LoadingState;

  displayedColumns: string[] = ["orderId", "orderDate", "cartTotal"];
  expandedElement: CustomerOrder | null = null;

  private readonly searchValue$ = new BehaviorSubject<string>("");
  private readonly paginatorReady$ = new BehaviorSubject<boolean>(false);

  orderTableData$ = combineLatest([
    this.store.select(selectOrderItems),
    this.store.select(selectOrderCallState),
    this.searchValue$,
    this.paginatorReady$,
  ]).pipe(
    map(([order, callState, searchValue, paginatorReady]) => {
      let dataSource = new MatTableDataSource(order);

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

      // Apply the search filter if there's a search value
      if (searchValue.length > 0) {
        dataSource.filter = searchValue.trim().toLowerCase();
      } else {
        dataSource.filter = "";
      }

      // Set paginator only when it's ready
      if (paginatorReady && this.paginator) {
        dataSource.paginator = this.paginator;
        // Reset to first page when filter is applied
        if (dataSource.filter) {
          this.paginator.firstPage();
        }
      }
      return { dataSource, callState };
    })
  );

  ngAfterViewInit() {
    this.paginatorReady$.next(true);
  }

  constructor() {
    this.store.dispatch(loadOrders());
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchValue$.next(filterValue);
  }
}
