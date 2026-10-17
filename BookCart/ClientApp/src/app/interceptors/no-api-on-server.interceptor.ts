import { HttpInterceptorFn } from "@angular/common/http";
import { inject, PLATFORM_ID } from "@angular/core";
import { isPlatformServer } from "@angular/common";
import { EMPTY } from "rxjs";

/**
 * While a page is drawn at build time there is no API to ask (no server is running, and the data belongs to whoever
 * visits). Calls to /api end without an answer there: the page is drawn in its "loading" state, which is also how the
 * browser starts, so the running app takes the drawn page over without a difference.
 */
export const noApiOnServerInterceptor: HttpInterceptorFn = (request, next) =>
  isPlatformServer(inject(PLATFORM_ID)) && request.url.startsWith("/api/")
    ? EMPTY
    : next(request);
