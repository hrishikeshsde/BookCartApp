import { provideHttpClient, withInterceptors, withXhr } from "@angular/common/http";
import { isDevMode, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
} from "@angular/router";
import { provideEffects } from "@ngrx/effects";
import { provideState, provideStore } from "@ngrx/store";
import { provideStoreDevtools } from "@ngrx/store-devtools";
import { AppComponent } from "./app/app.component";
import { errorInterceptor } from "./app/interceptors/error-interceptor.service";
import { authTokenInterceptor } from "./app/interceptors/http-interceptor.service";
import { APP_ROUTES } from "./app/routes/app.routes";
import { AuthEffects } from "./app/state/effects/auth.effects";
import { BookEffects } from "./app/state/effects/book.effects";
import { CartEffects } from "./app/state/effects/cart.effects";
import { CategoriesEffects } from "./app/state/effects/categories.effects";
import { WishlistEffects } from "./app/state/effects/wishlist.effects";
import {
  AUTH_FEATURE_KEY,
  authReducer,
} from "./app/state/reducers/auth.reducers";
import {
  BOOK_FEATURE_KEY,
  bookReducer,
} from "./app/state/reducers/book.reducers";
import {
  CART_FEATURE_KEY,
  cartReducer,
} from "./app/state/reducers/cart.reducers";
import {
  CATEGORIES_FEATURE_KEY,
  categoryReducer,
} from "./app/state/reducers/categories.reducers";
import {
  WISHLIST_FEATURE_KEY,
  wishlistReducer,
} from "./app/state/reducers/wishlist.reducers";

bootstrapApplication(AppComponent, {
  providers: [
    // No zone.js: components are OnPush and change through signals, inputs, events and the async pipe.
    provideZonelessChangeDetection(),
    // Angular 22 defaults to fetch; XHR keeps the behaviour the app was written and tested with (F6 revisits it).
    provideHttpClient(
      withXhr(),
      withInterceptors([authTokenInterceptor, errorInterceptor])
    ),
    provideRouter(
      APP_ROUTES,
      // Route and query parameters arrive as component inputs (id, category, item, returnUrl).
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: "top",
      }),
      withPreloading(PreloadAllModules)
    ),
    provideEffects(
      CategoriesEffects,
      BookEffects,
      AuthEffects,
      WishlistEffects,
      CartEffects
    ),
    provideState(CATEGORIES_FEATURE_KEY, categoryReducer),
    provideState(BOOK_FEATURE_KEY, bookReducer),
    provideState(AUTH_FEATURE_KEY, authReducer),
    provideState(WISHLIST_FEATURE_KEY, wishlistReducer),
    provideState(CART_FEATURE_KEY, cartReducer),
    provideStore(),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ],
}).catch((err) => console.error(err));
