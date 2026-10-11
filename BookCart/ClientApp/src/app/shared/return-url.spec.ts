import { safeReturnUrl } from "./return-url";

describe("safeReturnUrl", () => {
  it("keeps a path inside the app, with its query string", () => {
    expect(safeReturnUrl("/wishlist")).toBe("/wishlist");
    expect(safeReturnUrl("/search?item=smoke%20book")).toBe(
      "/search?item=smoke%20book"
    );
  });

  it("falls back to home when there is nothing to return to", () => {
    expect(safeReturnUrl(null)).toBe("/");
    expect(safeReturnUrl(undefined)).toBe("/");
    expect(safeReturnUrl("")).toBe("/");
  });

  it("refuses anything that could leave the app", () => {
    expect(safeReturnUrl("//evil.com")).toBe("/");
    expect(safeReturnUrl("https://evil.com")).toBe("/");
    expect(safeReturnUrl("javascript:alert(1)")).toBe("/");
    expect(safeReturnUrl("/\\evil.com")).toBe("/");
    expect(safeReturnUrl("wishlist")).toBe("/");
  });
});
