import { HttpErrorResponse } from "@angular/common/http";

/** What the login state holds for a 401 from the login call (wrong user name or password). */
export const INVALID_CREDENTIALS = "invalid-credentials";

/** A short, displayable text for whatever a failed call threw (an HTTP error, an Error or a plain string). */
export function errorText(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    if (body && typeof body === "object") {
      const problem = body as { detail?: unknown; title?: unknown };
      if (typeof problem.detail === "string" && problem.detail) {
        return problem.detail;
      }
      if (typeof problem.title === "string" && problem.title) {
        return problem.title;
      }
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
