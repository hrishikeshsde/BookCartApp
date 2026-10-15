import { Routes } from "@angular/router";
import { HomeComponent } from "../components/home/home.component";
import { adminGuard } from "../guards/admin-auth.guard";
import { authGuard } from "../guards/auth.guard";

export const APP_ROUTES: Routes = [
  { path: "", component: HomeComponent, pathMatch: "full", title: "Home" },
  { path: "filter", component: HomeComponent, title: "Home | Filter Books" },
  { path: "search", component: HomeComponent, title: "Home | Search Books" },
  {
    path: "login",
    loadComponent: () =>
      import("../components/login/login.component").then(
        (c) => c.LoginComponent
      ),
    title: "Login",
  },
  {
    path: "register",
    loadComponent: () =>
      import(
        "../components/user-registration/user-registration.component"
      ).then((c) => c.UserRegistrationComponent),
    title: "Register",
  },
  {
    path: "books/details/:id",
    loadComponent: () =>
      import("../components/book-details/book-details.component").then(
        (c) => c.BookDetailsComponent
      ),
    title: "Book Details",
  },
  {
    path: "shopping-cart",
    loadComponent: () =>
      import("../components/shoppingcart/shoppingcart.component").then(
        (c) => c.ShoppingcartComponent
      ),

    title: "Shopping Cart",
  },
  {
    path: "checkout",
    loadComponent: () =>
      import("../components/checkout/checkout.component").then(
        (c) => c.CheckoutComponent
      ),
    canActivate: [authGuard],
    title: "Checkout",
  },
  {
    path: "myorders",
    loadComponent: () =>
      import("../components/my-orders/my-orders.component").then(
        (c) => c.MyOrdersComponent
      ),
    canActivate: [authGuard],
    title: "My Order Details",
  },
  {
    path: "wishlist",
    loadComponent: () =>
      import("../components/wishlist/wishlist.component").then(
        (c) => c.WishlistComponent
      ),
    canActivate: [authGuard],
    title: "Wishlist",
  },
  {
    path: "admin/books",
    // The admin pages are not downloaded in the background: most visitors never open them (SelectivePreloadingStrategy).
    data: { preload: false },
    loadChildren: () => import("./admin.routes").then((m) => m.ADMIN_ROUTES),
    canMatch: [adminGuard],
    title: "Admin | Books",
  },
  {
    path: "**",
    loadComponent: () =>
      import("../components/page-not-found/page-not-found.component").then(
        (c) => c.PageNotFoundComponent
      ),
    title: "Not Found",
  },
];
