import { provideHttpClient, withInterceptors, withXhr } from "@angular/common/http";
import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
} from "@angular/router";
import { AppComponent } from "./app/app.component";
import { errorInterceptor } from "./app/interceptors/error-interceptor.service";
import { authTokenInterceptor } from "./app/interceptors/http-interceptor.service";
import { APP_ROUTES } from "./app/routes/app.routes";

// The application state lives in SignalStores under app/state (all providedIn: "root"), so nothing is registered here.
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
  ],
}).catch((err) => console.error(err));
