using Microsoft.EntityFrameworkCore;

namespace BookCart.Models
{
    /// <summary>
    /// What the database itself guarantees, on top of the scaffolded column mapping in <c>BookDBContext.cs</c>:
    /// relationships, uniqueness, value rules and column types. Every rule here is enforced by SQL Server, so it holds
    /// no matter which code (or which person with a query window) writes the data.
    /// </summary>
    public partial class BookDBContext
    {
        partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Book>(entity =>
            {
                // Titles and authors are not limited to ASCII (varchar would turn other scripts into question marks).
                entity.Property(e => e.Title).IsUnicode(true);
                entity.Property(e => e.Author).IsUnicode(true);

                entity.HasIndex(e => e.Category).HasDatabaseName("IX_Book_Category");
                entity.ToTable(t => t.HasCheckConstraint("CK_Book_Price", "[Price] >= 0"));
            });

            modelBuilder.Entity<UserMaster>(entity =>
            {
                entity.HasOne<UserType>().WithMany().HasForeignKey(e => e.UserTypeId).OnDelete(DeleteBehavior.Restrict);
            });

            // One cart per owner. The owner id is a user id or a guest id (a guest is not a user), so there is no foreign key to UserMaster.
            modelBuilder.Entity<Cart>(entity =>
            {
                entity.Property(e => e.DateCreated).HasColumnType("datetime2");
                entity.HasIndex(e => e.UserId).IsUnique().HasDatabaseName("UX_Cart_UserID");
            });

            modelBuilder.Entity<CartItems>(entity =>
            {
                entity.HasOne<Cart>().WithMany().HasForeignKey(e => e.CartId).OnDelete(DeleteBehavior.Cascade);
                // A book that is deleted leaves every cart it was in.
                entity.HasOne<Book>().WithMany().HasForeignKey(e => e.ProductId).OnDelete(DeleteBehavior.Cascade);
                entity.HasIndex(e => new { e.CartId, e.ProductId }).IsUnique().HasDatabaseName("UX_CartItems_CartId_ProductId");
                entity.ToTable(t => t.HasCheckConstraint("CK_CartItems_Quantity", "[Quantity] > 0"));
            });

            modelBuilder.Entity<Wishlist>(entity =>
            {
                entity.Property(e => e.DateCreated).HasColumnType("datetime2");
                entity.HasIndex(e => e.UserId).IsUnique().HasDatabaseName("UX_Wishlist_UserID");
            });

            modelBuilder.Entity<WishlistItems>(entity =>
            {
                entity.HasOne<Wishlist>().WithMany().HasForeignKey(e => e.WishlistId).OnDelete(DeleteBehavior.Cascade);
                entity.HasOne<Book>().WithMany().HasForeignKey(e => e.ProductId).OnDelete(DeleteBehavior.Cascade);
                entity.HasIndex(e => new { e.WishlistId, e.ProductId }).IsUnique().HasDatabaseName("UX_WishlistItems_WishlistId_ProductId");
            });

            modelBuilder.Entity<CustomerOrders>(entity =>
            {
                entity.Property(e => e.DateCreated).HasColumnType("datetime2");
                // "A user's orders, newest first" is the only way orders are listed.
                entity.HasIndex(e => new { e.UserId, e.DateCreated }).HasDatabaseName("IX_CustomerOrders_UserID_DateCreated");
            });

            // Order lines belong to their order. They deliberately have NO foreign key to Book: an order is a record of
            // what was bought at what price, and must survive the book being deleted from the catalogue.
            modelBuilder.Entity<CustomerOrderDetails>(entity =>
            {
                entity.HasOne<CustomerOrders>().WithMany().HasForeignKey(e => e.OrderId).OnDelete(DeleteBehavior.Cascade);
                entity.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_CustomerOrderDetails_Quantity", "[Quantity] > 0");
                    t.HasCheckConstraint("CK_CustomerOrderDetails_Price", "[Price] >= 0");
                });
            });
        }
    }
}
