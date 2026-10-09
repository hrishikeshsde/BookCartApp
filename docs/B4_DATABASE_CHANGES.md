# B4: Database, Migrations and Catalog Queries

The schema is now defined by EF Core migrations (`BookCart/Migrations`) and the database itself enforces the rules the code used to hope for. **Existing databases must be upgraded before running this version** (`/health` reports 503 until they are).

## Upgrading an existing database (one created from `DBScript/BookDB.txt`)

Do these in order; stop at the first failure. Nothing here has been run against your real database: it was rehearsed on a scratch copy loaded with deliberately dirty data, and on the local dev database.

1. **Back up.** `BACKUP DATABASE [BookDB] TO DISK = N'<path>' WITH INIT;` (no `COMPRESSION` on Express/LocalDB). The cleanup in step 4 deletes and merges rows, so the backup is the only way back.
2. **Make sure it is at the B0.2 schema** (has `UserMaster.PasswordHash`). If not, run `DBScript/B0.2_password_hash.sql` first.
3. **Adopt the migrations history:** `sqlcmd -S <server> -d <database> -i DBScript/B4_adopt_migrations.sql`. It changes no table; it records that the `Baseline` migration (the schema `BookDB.txt` creates) is already in place, and refuses a database that is not at the expected starting point. Safe to run twice.
4. **Apply the rest**, either
   - `BOOKCART_EF_CONNECTION="<connection string>" dotnet ef database update --project BookCart` (restore the tool once with `dotnet tool restore`), or
   - `dotnet ef migrations script --idempotent --project BookCart -o schema.sql`, review it, run it with `sqlcmd -I -b -d <database> -i schema.sql`.
5. Deploy this version of the app.

**A brand-new database** needs none of this: create an empty database and run step 4. The migrations create everything, including the user types and categories.

If step 4 stops with a message such as "Book has negative prices", nothing was changed (the migration is one transaction). Fix the rows it names and run it again.

## What the upgrade does to existing data

| Data | Result |
|---|---|
| Several carts (or wishlists) for one owner (a race in the old code) | Merged into the oldest; items moved, quantities added |
| The same book twice in one cart | One line, quantities added (wishlist: one entry) |
| Cart lines for a missing cart or book, or with quantity 0 | Deleted |
| Wishlist entries for a missing wishlist or book | Deleted |
| Negative book prices; order lines with quantity <= 0, a negative price or no order; users with an unknown type | **Stops with a message.** Never changed automatically |
| Order history, users, books, guest carts | Untouched (dates move from `datetime` to `datetime2` with the same value) |

## What the database now enforces

- **Relationships:** cart lines -> cart and book; wishlist lines -> wishlist and book; order lines -> order; user -> user type.
- **Uniqueness:** one cart and one wishlist per owner; a book once per cart/wishlist; unique username (already from B0.2).
- **Value rules:** book price >= 0; cart quantity > 0; order line quantity > 0 and price >= 0.
- **Cascades:** deleting a book removes it from every cart and wishlist. Order lines deliberately have **no** foreign key to books, so an order keeps its history after a book is deleted (it then shows "(book no longer available)").
- **Types:** `Title` and `Author` are `nvarchar(100)` (any script, not only ASCII); `DateCreated` columns are `datetime2`.
- **Indexes:** book category; cart/wishlist owner; order lines by order; orders by (user, date); lines by book.

## Code changes that follow from it

- `CartService`/`WishlistService` handle the new races: if two requests create the same cart or line at once, the loser carries on with the winner's row instead of failing (tested with 12 parallel requests, repeated). `OrderService` and the cart read became single joins, because cart rows are always valid.
- Health: `/health` is unhealthy when the database is unreachable **or has pending migrations**.
- A design-time factory (`BookDBContextFactory`) lets `dotnet ef` run without the web host or secrets; it uses `BOOKCART_EF_CONNECTION`, or the local `BookDB_Dev` database by default. `dotnet-tools.json` pins `dotnet-ef` 10.0.12.
- Tests now build their database with the real migrations, and fail if the model changes without a migration (`The_migrations_describe_exactly_the_current_model`).

## New and changed API

- `GET api/book/search?page&pageSize&category&search&minPrice&maxPrice` returns `{ items, total, page, pageSize }`: filtering, ordering by title and paging happen in the database. Defaults: page 1, 24 per page, max 100. `search` matches title or author, case-insensitive, with `%` `_` `[` taken literally. Invalid values are a 400 naming the field. Not cached (an admin's new book shows at once). `GET api/book` (the full list, cached) is unchanged; the Angular app still uses it.
- `GET api/book/GetSimilarBooks/{id}`: still five random books of the category, now chosen from the ids only instead of sorting every row by a random GUID.

## Rolling back

`Down()` is generated for both migrations, but the data cleanup cannot be undone and narrowing columns back would lose non-ASCII text and sub-millisecond time: **restore the backup** instead. To remove a migration from the code before it is applied anywhere: `dotnet ef migrations remove --project BookCart`.

## Adding a migration from now on

Change the model (`Models/BookDBContext.Schema.cs` for rules, the entity classes for columns), then `dotnet ef migrations add <Name> --project BookCart --configuration Release`. Review the generated file; a migration that changes existing data needs the same care as `SchemaHardening`. Do not edit `DBScript/BookDB.txt`.

## Not done / follow-ups

- The real database has not been backed up or upgraded (pending, as agreed).
- `Book.Category` is still free text duplicating `Categories` (a real foreign key also changes the Angular model and filters).
- Optimistic concurrency on `Book` (a row version) needs the client to send it back; not added.
- The Angular catalog still loads every book and filters in the browser; moving it to `api/book/search` is a frontend change.
