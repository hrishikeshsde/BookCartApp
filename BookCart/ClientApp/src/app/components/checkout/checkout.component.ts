import { CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";
import {
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { MatButton } from "@angular/material/button";
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
} from "@angular/material/card";
import { MatError, MatFormField, MatLabel } from "@angular/material/form-field";
import { MatInput } from "@angular/material/input";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { Router, RouterLink } from "@angular/router";
import { finalize } from "rxjs";
import { CheckOutForm } from "src/app/models/checkoutForm";
import { CheckoutService } from "src/app/services/checkout.service";
import { SnackbarService } from "src/app/services/snackbar.service";
import { CartStore } from "src/app/state/cart/cart.store";

@Component({
  selector: "app-checkout",
  templateUrl: "./checkout.component.html",
  styleUrls: ["./checkout.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatInput,
    MatError,
    MatCardActions,
    MatButton,
    RouterLink,
    MatProgressSpinner,
    CurrencyPipe,
  ],
})
export class CheckoutComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly cart = inject(CartStore);
  private readonly checkoutService = inject(CheckoutService);
  private readonly snackbar = inject(SnackbarService);
  private readonly router = inject(Router);

  /** True while the order is being placed, so a double click cannot send it twice. */
  protected readonly placing = signal(false);

  checkOutForm: FormGroup<CheckOutForm> = this.fb.group({
    name: ["", Validators.required],
    addressLine1: ["", Validators.required],
    addressLine2: ["", Validators.required],
    pincode: [
      "",
      [Validators.required, Validators.pattern("^[1-9][0-9]{5}$")],
    ],
    state: ["", [Validators.required]],
  });

  get checkoutFormControl() {
    return this.checkOutForm.controls;
  }

  private readonly items = this.cart.items;

  protected readonly checkOutItems = computed(() => ({
    items: this.items(),
    /** The cart has not answered yet (the first load, or a reload). */
    pending: this.cart.loading() || this.cart.callState() === "init",
    loaded: this.cart.loaded(),
  }));

  readonly totalPrice = this.cart.total;

  constructor() {
    // Nothing to order (the cart came back empty): there is nothing to fill in either.
    effect(() => {
      if (this.items().length === 0 && this.cart.loaded()) {
        this.checkOutForm.disable();
      }
    });
  }

  /**
   * Nothing about the order is sent: the server orders what is in its copy of the cart, at its prices. Either way the
   * server's cart is what to show afterwards (it is empty after an order).
   */
  placeOrder() {
    if (!this.checkOutForm.valid || this.placing()) {
      return;
    }
    this.placing.set(true);
    this.checkoutService
      .placeOrder()
      .pipe(finalize(() => this.placing.set(false)))
      .subscribe({
        next: () => {
          this.snackbar.showSnackBar("Order placed successfully!!!");
          this.router.navigate(["/myorders"]);
          this.cart.load();
        },
        error: () => {
          this.snackbar.showSnackBar(
            "The order could not be placed. Your cart may be empty or have changed: please review it and try again."
          );
          this.cart.load();
        },
      });
  }
}
