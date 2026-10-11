import { CurrencyPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
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
import { RouterLink } from "@angular/router";
import { Store } from "@ngrx/store";
import { CheckOutForm } from "src/app/models/checkoutForm";
import { LoadingState } from "src/app/shared/call-state";
import { placeOrder } from "src/app/state/actions/checkout.actions";
import {
  selectCartCallState,
  selectCartItems,
} from "src/app/state/selectors/cart.selectors";

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
  private readonly store = inject(Store);
  protected readonly loadingState = LoadingState;

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

  private readonly items = this.store.selectSignal(selectCartItems);
  private readonly callState = this.store.selectSignal(selectCartCallState);

  protected readonly checkOutItems = computed(() => ({
    items: this.items(),
    callState: this.callState(),
  }));

  readonly totalPrice = computed(() =>
    this.items().reduce(
      (total, item) => total + item.book.price * item.quantity,
      0
    )
  );

  constructor() {
    // Nothing to order (the cart came back empty): there is nothing to fill in either.
    effect(() => {
      if (
        this.items().length === 0 &&
        this.callState() === LoadingState.LOADED
      ) {
        this.checkOutForm.disable();
      }
    });
  }

  placeOrder() {
    if (this.checkOutForm.valid) {
      this.store.dispatch(placeOrder());
    }
  }
}
