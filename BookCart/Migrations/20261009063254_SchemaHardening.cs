using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BookCart.Migrations
{
    /// <summary>
    /// Adds the rules the database enforces itself: relationships, uniqueness, value checks, better column types.
    /// Existing data is first brought in line. Rows that could never have been valid (cart lines for a book or cart that
    /// does not exist, quantities of 0) are deleted; duplicates the old code could create (two carts for one owner, one
    /// book twice in a cart) are merged, adding quantities up; anything that needs a person's decision (negative prices,
    /// order history that does not add up) stops the migration with a message instead of being changed.
    /// The whole migration runs in one transaction, so a stop leaves the database exactly as it was.
    /// </summary>
    public partial class SchemaHardening : Migration
    {
        const string StopOnDataNeedingADecision = """
            IF EXISTS (SELECT 1 FROM Book WHERE Price < 0)
                THROW 50001, 'Book has negative prices. Correct them (UPDATE Book SET Price = ... WHERE Price < 0) and run the migration again.', 1;
            IF EXISTS (SELECT 1 FROM CustomerOrderDetails WHERE Quantity <= 0 OR Price < 0)
                THROW 50002, 'CustomerOrderDetails has lines with a quantity of 0 or less, or a negative price. Order history is not changed automatically: review those rows and run the migration again.', 1;
            IF EXISTS (SELECT 1 FROM CustomerOrderDetails d WHERE NOT EXISTS (SELECT 1 FROM CustomerOrders o WHERE o.OrderId = d.OrderId))
                THROW 50003, 'CustomerOrderDetails has lines whose order does not exist. Review those rows and run the migration again.', 1;
            IF EXISTS (SELECT 1 FROM UserMaster u WHERE NOT EXISTS (SELECT 1 FROM UserType t WHERE t.UserTypeID = u.UserTypeID))
                THROW 50004, 'UserMaster has users with a UserTypeID that does not exist in UserType. Correct them and run the migration again.', 1;
            """;

        const string DeleteRowsThatWereNeverValid = """
            DELETE FROM CartItems
            WHERE Quantity <= 0
               OR NOT EXISTS (SELECT 1 FROM Cart c WHERE c.CartId = CartItems.CartId)
               OR NOT EXISTS (SELECT 1 FROM Book b WHERE b.BookID = CartItems.ProductId);

            DELETE FROM WishlistItems
            WHERE NOT EXISTS (SELECT 1 FROM Wishlist w WHERE w.WishlistId = WishlistItems.WishlistId)
               OR NOT EXISTS (SELECT 1 FROM Book b WHERE b.BookID = WishlistItems.ProductId);
            """;

        // The old code could create several carts (or wishlists) for one owner when two requests raced. Keep the oldest
        // and move everything else into it.
        const string MergeDuplicateCartsAndWishlists = """
            SELECT CartId, FIRST_VALUE(CartId) OVER (PARTITION BY UserID ORDER BY DateCreated, CartId) AS KeepId
            INTO #CartMap FROM Cart;
            UPDATE ci SET ci.CartId = m.KeepId FROM CartItems ci JOIN #CartMap m ON m.CartId = ci.CartId WHERE m.CartId <> m.KeepId;
            DELETE c FROM Cart c JOIN #CartMap m ON m.CartId = c.CartId WHERE m.CartId <> m.KeepId;
            DROP TABLE #CartMap;

            SELECT WishlistId, FIRST_VALUE(WishlistId) OVER (PARTITION BY UserID ORDER BY DateCreated, WishlistId) AS KeepId
            INTO #WishlistMap FROM Wishlist;
            UPDATE wi SET wi.WishlistId = m.KeepId FROM WishlistItems wi JOIN #WishlistMap m ON m.WishlistId = wi.WishlistId WHERE m.WishlistId <> m.KeepId;
            DELETE w FROM Wishlist w JOIN #WishlistMap m ON m.WishlistId = w.WishlistId WHERE m.WishlistId <> m.KeepId;
            DROP TABLE #WishlistMap;
            """;

        // The same book twice in one cart becomes one line with the quantities added up (on a wishlist, one entry).
        const string MergeDuplicateLines = """
            SELECT CartItemId,
                   SUM(Quantity) OVER (PARTITION BY CartId, ProductId) AS Total,
                   ROW_NUMBER() OVER (PARTITION BY CartId, ProductId ORDER BY CartItemId) AS Rn
            INTO #CartLines FROM CartItems;
            UPDATE ci SET ci.Quantity = l.Total FROM CartItems ci JOIN #CartLines l ON l.CartItemId = ci.CartItemId WHERE l.Rn = 1 AND ci.Quantity <> l.Total;
            DELETE ci FROM CartItems ci JOIN #CartLines l ON l.CartItemId = ci.CartItemId WHERE l.Rn > 1;
            DROP TABLE #CartLines;

            SELECT WishlistItemId,
                   ROW_NUMBER() OVER (PARTITION BY WishlistId, ProductId ORDER BY WishlistItemId) AS Rn
            INTO #WishlistLines FROM WishlistItems;
            DELETE wi FROM WishlistItems wi JOIN #WishlistLines l ON l.WishlistItemId = wi.WishlistItemId WHERE l.Rn > 1;
            DROP TABLE #WishlistLines;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(StopOnDataNeedingADecision);
            migrationBuilder.Sql(DeleteRowsThatWereNeverValid);
            migrationBuilder.Sql(MergeDuplicateCartsAndWishlists);
            migrationBuilder.Sql(MergeDuplicateLines);

            migrationBuilder.AlterColumn<DateTime>(
                name: "DateCreated",
                table: "Wishlist",
                type: "datetime2",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime");

            migrationBuilder.AlterColumn<DateTime>(
                name: "DateCreated",
                table: "CustomerOrders",
                type: "datetime2",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime");

            migrationBuilder.AlterColumn<DateTime>(
                name: "DateCreated",
                table: "Cart",
                type: "datetime2",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "Book",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "varchar(100)",
                oldUnicode: false,
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "Author",
                table: "Book",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "varchar(100)",
                oldUnicode: false,
                oldMaxLength: 100);

            migrationBuilder.CreateIndex(
                name: "IX_WishlistItems_ProductId",
                table: "WishlistItems",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "UX_WishlistItems_WishlistId_ProductId",
                table: "WishlistItems",
                columns: new[] { "WishlistId", "ProductId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Wishlist_UserID",
                table: "Wishlist",
                column: "UserID",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserMaster_UserTypeID",
                table: "UserMaster",
                column: "UserTypeID");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerOrders_UserID_DateCreated",
                table: "CustomerOrders",
                columns: new[] { "UserID", "DateCreated" });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerOrderDetails_OrderId",
                table: "CustomerOrderDetails",
                column: "OrderId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomerOrderDetails_Price",
                table: "CustomerOrderDetails",
                sql: "[Price] >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CustomerOrderDetails_Quantity",
                table: "CustomerOrderDetails",
                sql: "[Quantity] > 0");

            migrationBuilder.CreateIndex(
                name: "IX_CartItems_ProductId",
                table: "CartItems",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "UX_CartItems_CartId_ProductId",
                table: "CartItems",
                columns: new[] { "CartId", "ProductId" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_CartItems_Quantity",
                table: "CartItems",
                sql: "[Quantity] > 0");

            migrationBuilder.CreateIndex(
                name: "UX_Cart_UserID",
                table: "Cart",
                column: "UserID",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Book_Category",
                table: "Book",
                column: "Category");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Book_Price",
                table: "Book",
                sql: "[Price] >= 0");

            migrationBuilder.AddForeignKey(
                name: "FK_CartItems_Book_ProductId",
                table: "CartItems",
                column: "ProductId",
                principalTable: "Book",
                principalColumn: "BookID",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_CartItems_Cart_CartId",
                table: "CartItems",
                column: "CartId",
                principalTable: "Cart",
                principalColumn: "CartId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_CustomerOrderDetails_CustomerOrders_OrderId",
                table: "CustomerOrderDetails",
                column: "OrderId",
                principalTable: "CustomerOrders",
                principalColumn: "OrderId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_UserMaster_UserType_UserTypeID",
                table: "UserMaster",
                column: "UserTypeID",
                principalTable: "UserType",
                principalColumn: "UserTypeID",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_WishlistItems_Book_ProductId",
                table: "WishlistItems",
                column: "ProductId",
                principalTable: "Book",
                principalColumn: "BookID",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_WishlistItems_Wishlist_WishlistId",
                table: "WishlistItems",
                column: "WishlistId",
                principalTable: "Wishlist",
                principalColumn: "WishlistId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CartItems_Book_ProductId",
                table: "CartItems");

            migrationBuilder.DropForeignKey(
                name: "FK_CartItems_Cart_CartId",
                table: "CartItems");

            migrationBuilder.DropForeignKey(
                name: "FK_CustomerOrderDetails_CustomerOrders_OrderId",
                table: "CustomerOrderDetails");

            migrationBuilder.DropForeignKey(
                name: "FK_UserMaster_UserType_UserTypeID",
                table: "UserMaster");

            migrationBuilder.DropForeignKey(
                name: "FK_WishlistItems_Book_ProductId",
                table: "WishlistItems");

            migrationBuilder.DropForeignKey(
                name: "FK_WishlistItems_Wishlist_WishlistId",
                table: "WishlistItems");

            migrationBuilder.DropIndex(
                name: "IX_WishlistItems_ProductId",
                table: "WishlistItems");

            migrationBuilder.DropIndex(
                name: "UX_WishlistItems_WishlistId_ProductId",
                table: "WishlistItems");

            migrationBuilder.DropIndex(
                name: "UX_Wishlist_UserID",
                table: "Wishlist");

            migrationBuilder.DropIndex(
                name: "IX_UserMaster_UserTypeID",
                table: "UserMaster");

            migrationBuilder.DropIndex(
                name: "IX_CustomerOrders_UserID_DateCreated",
                table: "CustomerOrders");

            migrationBuilder.DropIndex(
                name: "IX_CustomerOrderDetails_OrderId",
                table: "CustomerOrderDetails");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomerOrderDetails_Price",
                table: "CustomerOrderDetails");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CustomerOrderDetails_Quantity",
                table: "CustomerOrderDetails");

            migrationBuilder.DropIndex(
                name: "IX_CartItems_ProductId",
                table: "CartItems");

            migrationBuilder.DropIndex(
                name: "UX_CartItems_CartId_ProductId",
                table: "CartItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CartItems_Quantity",
                table: "CartItems");

            migrationBuilder.DropIndex(
                name: "UX_Cart_UserID",
                table: "Cart");

            migrationBuilder.DropIndex(
                name: "IX_Book_Category",
                table: "Book");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Book_Price",
                table: "Book");

            migrationBuilder.AlterColumn<DateTime>(
                name: "DateCreated",
                table: "Wishlist",
                type: "datetime",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime2");

            migrationBuilder.AlterColumn<DateTime>(
                name: "DateCreated",
                table: "CustomerOrders",
                type: "datetime",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime2");

            migrationBuilder.AlterColumn<DateTime>(
                name: "DateCreated",
                table: "Cart",
                type: "datetime",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "datetime2");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "Book",
                type: "varchar(100)",
                unicode: false,
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "Author",
                table: "Book",
                type: "varchar(100)",
                unicode: false,
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);
        }
    }
}
