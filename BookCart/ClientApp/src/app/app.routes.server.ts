import { RenderMode, ServerRoute } from "@angular/ssr";

/**
 * Which pages are drawn at build time. Only the public pages whose content does not depend on who asks or on the
 * catalogue: the home page (its frame; the books arrive from the API in the browser), login and register. Everything else
 * (the details page, the cart, checkout, orders, the wishlist, admin) is drawn in the browser as before.
 */
export const serverRoutes: ServerRoute[] = [
  { path: "", renderMode: RenderMode.Prerender },
  { path: "login", renderMode: RenderMode.Prerender },
  { path: "register", renderMode: RenderMode.Prerender },
  { path: "**", renderMode: RenderMode.Client },
];
