import { HttpErrorResponse } from "@angular/common/http";
import { errorText } from "./http-error";

describe("errorText", () => {
  it("prefers the detail of a problem-details body", () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { title: "Conflict", detail: "That username is already taken." },
    });
    expect(errorText(error)).toBe("That username is already taken.");
  });

  it("falls back to the title, then to the HTTP message", () => {
    expect(
      errorText(new HttpErrorResponse({ status: 429, error: { title: "Too Many Requests" } }))
    ).toBe("Too Many Requests");
    const plain = new HttpErrorResponse({ status: 500, statusText: "Server Error", url: "/api/x" });
    expect(errorText(plain)).toBe(plain.message);
  });

  it("reads an Error and a string", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain text")).toBe("plain text");
  });
});
