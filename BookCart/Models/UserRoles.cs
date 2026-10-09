namespace BookCart.Models
{
    public static class UserRoles
    {
        public const string Admin = "Admin";
        public const string User = "User";
    }

    /// <summary>The UserType rows seeded by DBScript/BookDB.txt.</summary>
    public static class UserTypeIds
    {
        public const int Admin = 1;
        public const int User = 2;

        public static string RoleName(int userTypeId) => userTypeId == Admin ? UserRoles.Admin : UserRoles.User;
    }
}
