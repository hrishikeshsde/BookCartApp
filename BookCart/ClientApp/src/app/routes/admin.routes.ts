import { Routes } from "@angular/router";

export const ADMIN_ROUTES: Routes = [
  {
    path: "",
    children: [
      {
        path: "new",
        loadComponent: () =>
          import(
            "../components/admin/book-form-page/book-form-page.component"
          ).then((c) => c.BookFormPageComponent),
        title: "Admin | Add Book",
      },
      {
        path: ":id",
        loadComponent: () =>
          import(
            "../components/admin/book-form-page/book-form-page.component"
          ).then((c) => c.BookFormPageComponent),
        title: "Admin | Update Book",
      },
      {
        path: "",
        loadComponent: () =>
          import(
            "../components/admin/manage-books/manage-books.component"
          ).then((c) => c.ManageBooksComponent),
      },
    ],
  },
];
