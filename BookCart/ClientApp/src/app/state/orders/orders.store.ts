import { effect, inject, untracked } from "@angular/core";
import { tapResponse } from "@ngrx/operators";
import {
  patchState,
  signalStore,
  withHooks,
  withMethods,
  withState,
} from "@ngrx/signals";
import { rxMethod } from "@ngrx/signals/rxjs-interop";
import { filter, pipe, switchMap, tap } from "rxjs";
import { CustomerOrder } from "src/app/models/order";
import { MyordersService } from "src/app/services/myorders.service";
import { errorText } from "src/app/shared/http-error";
import {
  setError,
  setInit,
  setLoaded,
  setLoading,
  withCallState,
} from "src/app/shared/with-call-state";
import { AuthStore } from "../auth/auth.store";

/** The signed-in user's orders. Nothing of theirs stays in memory after they leave. */
export const OrdersStore = signalStore(
  { providedIn: "root" },
  withState<{ orders: CustomerOrder[] }>({ orders: [] }),
  withCallState(),
  withMethods(
    (
      store,
      auth = inject(AuthStore),
      myordersService = inject(MyordersService)
    ) => ({
      /** Fetches the orders (the My Orders page does this each time it opens). */
      load: rxMethod<void>(
        pipe(
          filter(() => {
            if (auth.isAuthenticated()) {
              return true;
            }
            patchState(store, setError("User not found"));
            return false;
          }),
          tap(() => patchState(store, setLoading())),
          switchMap(() =>
            myordersService.myOrderDetails().pipe(
              tapResponse({
                next: (orders) => patchState(store, { orders }, setLoaded()),
                error: (error) => patchState(store, setError(errorText(error))),
              })
            )
          )
        )
      ),
    })
  ),
  withHooks((store, auth = inject(AuthStore)) => ({
    onInit() {
      effect(() => {
        if (auth.userId() === null) {
          untracked(() => patchState(store, { orders: [] }, setInit()));
        }
      });
    },
  }))
);
