# B3: API Contract Changes and Migration Notes

Backend and frontend change together: the Angular app in this repo is already updated (services, effects, admin form, summary component). Any other client must follow the tables below. Tests: 151 in `BookCart.Tests`; the Angular app builds (development and production).

## Routes

No URL carries a user id any more. Who is calling comes from the JWT, or else from the guest cookie.

| Before | Now | Notes |
|---|---|---|
| `GET api/shoppingcart/{userId}` | `GET api/shoppingcart` | Empty list for a visitor with no cart; creates nothing |
| `POST api/shoppingcart/AddToCart/{userId}/{bookId}` | `POST api/shoppingcart/items/{bookId}` | Returns the updated cart. Starts the guest session if the caller has no identity. 404 for an unknown book |
| `PUT api/shoppingcart/{userId}/{bookId}` | `PATCH api/shoppingcart/items/{bookId}` | One copy less; the last copy removes the book (no quantity 0 rows) |
| `DELETE api/shoppingcart/{userId}/{bookId}` | `DELETE api/shoppingcart/items/{bookId}` | Returns the updated cart |
| `DELETE api/shoppingcart/{userId}` | `DELETE api/shoppingcart` | 204 |
| `GET api/user/{userId}` | `GET api/shoppingcart/count` | Item count |
| `GET api/shoppingcart/SetShoppingCart/{old}/{new}` | removed | Login merges the guest cart on the server |
| `GET api/wishlist/{userId}` | `GET api/wishlist` | Login required |
| `POST api/wishlist/ToggleWishlist/{userId}/{bookId}` | `POST api/wishlist/items/{bookId}` | Returns the updated list. 404 for an unknown book |
| `DELETE api/wishlist/{userId}` | `DELETE api/wishlist` | 204 |
| `GET api/order/{userId}` | `GET api/order` | Own orders only, newest first, `orderDate` is UTC (`Z`) |
| `POST api/checkout/{userId}` + body | `POST api/checkout` | Body ignored; returns `{ orderId }`; 409 if nothing to check out |

The old shapes now answer 404 (GET) or 405 (other methods).

## Books (admin)

- `POST api/book` / `PUT api/book`: `multipart/form-data` with one field per property: `bookId` (PUT only), `title` (max 100), `author` (max 100), `category` (max 20), `price` (0 to 99,999,999.99, required), plus optional `file`. The old `bookFormData` JSON field is gone; a `coverFileName` field is ignored. Invalid input is a 400 listing the fields; a non-form body is 415.
- POST answers **201** with the saved book (`Location` header), PUT **200** with the saved book (they used to answer the number `1`, which the Angular reducers then stored as a book), DELETE **204**.
- Book, category, cart and order JSON are DTOs with the same camelCase names as before. Order lines carry `book.bookId/title/author/category/price/coverFileName` (price = price paid; a deleted book shows as "(book no longer available)").

## New: book summaries

`POST api/book/{id}/summary` returns `{ summary }`. Public, rate limited (`RateLimiting:SummaryPermitLimit`, default 5/min per client), cached per book for `Gemini:CacheDays` (default 7). Set `Gemini:ApiKey` (user-secrets or `Gemini__ApiKey`); without it the answer is 503. AI service errors are 502. The browser no longer calls Google, so `@google/genai` and the CSP `connect-src` allowance are removed.

## Behaviour changes worth knowing

- **Guest session**: no client work needed. The first `POST items/{bookId}` without a token sets the encrypted HttpOnly `bc_guest` cookie (30 days); the same-origin Angular app sends it automatically. A client on another origin must send credentials.
- **Login** merges the guest cart into the user's (quantities add) and deletes the cookie; a failed login changes nothing.
- **Reads create nothing** (carts and wishlists used to be created by any read).
- **Config**: new optional `Gemini:*` section; new `RateLimiting:SummaryPermitLimit`. The solution now builds with warnings as errors.
- **Removed**: `DataAccess/`, `Interfaces/`, `RequireOwnerAttribute`, `Dto/OrdersDto`, `Dto/Checkout`, the Angular `selectCurrentUserId`/`setTempUserId` (no more random guest id in `localStorage`).

## Frontend files changed

`services/` (cart, wishlist, myorders, checkout, authentication, book), `state/effects/` (cart, wishlist, order, checkout, auth), `state/selectors/auth.selectors.ts`, `app.component.ts` (loads the cart at start), `admin/book-form` (fields, fresh `FormData` per submit), `book-summary` + `book-details` (calls the API), `addtowishlist`, `package.json`/lock (`@google/genai` removed).

## Not covered

No browser run of the Angular app (compiled, not clicked through); Karma specs still the old boilerplate (two do not type-check); initial bundle 1.08 MB vs the 1 MB budget warning; real-database backup pending.
