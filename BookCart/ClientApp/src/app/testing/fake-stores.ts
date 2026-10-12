import { computed, signal } from "@angular/core";
import { CustomerOrder } from "../models/order";
import { Book } from "../models/book";
import { ShoppingCart } from "../models/shoppingcart";
import { User } from "../models/user";
import { CallState } from "../shared/with-call-state";

/**
 * Stand-ins for the SignalStores in component specs: the same signals, filled with what a spec gives them, and spies for
 * the methods. Provide one with `{ provide: CartStore, useValue: fakeCartStore(items) }`; change what it shows by
 * setting its signals (`fake.items.set([...])`). The stores themselves are tested in their own specs.
 */

/** `callState` with the `loading`, `loaded` and `error` signals every store has. */
export function fakeCallState(initial: CallState = "loaded") {
  const callState = signal<CallState>(initial);
  return {
    callState,
    loading: computed(() => callState() === "loading"),
    loaded: computed(() => callState() === "loaded"),
    error: computed(() => {
      const state = callState();
      return typeof state === "object" ? state.error : null;
    }),
  };
}

export function fakeAuthStore(initialUser: User | null = null) {
  const user = signal<User | null>(initialUser);
  return {
    ...fakeCallState("init"),
    user,
    isAuthenticated: computed(() => user() !== null),
    isAdmin: computed(() => user()?.userTypeName === "Admin"),
    userId: computed(() => user()?.userId ?? null),
    login: vi.fn(),
    logout: vi.fn(),
    expireSession: vi.fn(),
    resetLoginError: vi.fn(),
  };
}

export function fakeCartStore(initialItems: ShoppingCart[] = [], initial: CallState = "loaded") {
  const items = signal(initialItems);
  return {
    ...fakeCallState(initial),
    items,
    count: computed(() => items().reduce((count, item) => count + item.quantity, 0)),
    total: computed(() => items().reduce((total, item) => total + item.book.price * item.quantity, 0)),
    load: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    reduce: vi.fn(),
    clear: vi.fn(),
  };
}

export function fakeWishlistStore(initialItems: Book[] = [], initial: CallState = "loaded") {
  const items = signal(initialItems);
  return {
    ...fakeCallState(initial),
    items,
    count: computed(() => items().length),
    ids: computed(() => new Set(items().map((book) => book.bookId))),
    load: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
  };
}

export function fakeOrdersStore(initialOrders: CustomerOrder[] = [], initial: CallState = "loaded") {
  return {
    ...fakeCallState(initial),
    orders: signal(initialOrders),
    load: vi.fn(),
  };
}
