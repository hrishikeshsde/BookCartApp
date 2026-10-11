import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { TokenStorage } from "../services/token-storage.service";

/** Sends the login token (if there is a valid one) with every request. */
export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(TokenStorage).get();
  return next(
    token
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request
  );
};
