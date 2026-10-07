using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using System.Globalization;

namespace BookCart.Services
{
    /// <summary>
    /// Blocks access to an action whose route carries a <c>{userId}</c> unless that id belongs to the caller
    /// (their own user id, their own guest cart id) or the caller is an admin. Actions without a
    /// <c>userId</c> route value are left alone.
    /// <list type="bullet">
    /// <item>No identity at all (no valid token, no guest cookie): 401.</item>
    /// <item>An identity that does not own the id: 403.</item>
    /// </list>
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
    public sealed class RequireOwnerAttribute : Attribute, IAsyncAuthorizationFilter
    {
        public Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            if (!context.RouteData.Values.TryGetValue("userId", out var raw))
            {
                return Task.CompletedTask;
            }

            if (!int.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.None, CultureInfo.InvariantCulture, out var userId))
            {
                context.Result = new BadRequestResult();
                return Task.CompletedTask;
            }

            var caller = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            if (caller.Owns(userId))
            {
                return Task.CompletedTask;
            }

            context.Result = caller.IsAuthenticated || caller.GuestId is not null
                ? new ForbidResult()
                : new ChallengeResult();
            return Task.CompletedTask;
        }
    }
}
