import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from "@angular/common/http";
import {
  ApplicationConfig,
  provideZonelessChangeDetection,
} from "@angular/core";
import {
  provideClientHydration,
  withNoIncrementalHydration,
} from "@angular/platform-browser";
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
} from "@angular/router";
import { errorInterceptor } from "./interceptors/error-interceptor.service";
import { authTokenInterceptor } from "./interceptors/http-interceptor.service";
import { noApiOnServerInterceptor } from "./interceptors/no-api-on-server.interceptor";
import { APP_ROUTES } from "./routes/app.routes";
import { SelectivePreloadingStrategy } from "./routes/selective-preload";

// The application state lives in SignalStores under app/state (all providedIn: "root"), so nothing is registered here.
export const appConfig: ApplicationConfig = {
  providers: [
    // No zone.js: components are OnPush and change through signals, inputs, events and the async pipe.
    provideZonelessChangeDetection(),
    provideHttpClient(
      withFetch(),
      withInterceptors([
        noApiOnServerInterceptor,
        authTokenInterceptor,
        errorInterceptor,
      ])
    ),
    provideRouter(
      APP_ROUTES,
      // Route and query parameters arrive as component inputs (id, category, item, returnUrl).
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: "top",
      }),
      withPreloading(SelectivePreloadingStrategy)
    ),
    // The pages prerendered at build time (see app.routes.server.ts) are taken over by the running app instead of being
    // thrown away and drawn again. Incremental hydration (and with it event replay) is off: it puts an inline script in
    // every page, which the Content-Security-Policy (script-src 'self') blocks, and nothing here needs it.
    provideClientHydration(withNoIncrementalHydration()),
  ],
};
