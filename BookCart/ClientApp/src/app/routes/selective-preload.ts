import { Injectable } from "@angular/core";
import { PreloadingStrategy, Route } from "@angular/router";
import { EMPTY, Observable } from "rxjs";

/**
 * Downloads every lazy route in the background once the app has started, except the routes marked
 * `data: { preload: false }` (the admin pages: most visitors never open them).
 */
@Injectable({ providedIn: "root" })
export class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return route.data?.["preload"] === false ? EMPTY : load();
  }
}
