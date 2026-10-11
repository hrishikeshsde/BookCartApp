/** A return URL is only followed when it is a path inside this app: "/cart" yes, "//evil.com" or "https://..." no. */
export function safeReturnUrl(url: string | null | undefined): string {
  return url &&
    url.startsWith("/") &&
    !url.startsWith("//") &&
    !url.startsWith("/\\")
    ? url
    : "/";
}
