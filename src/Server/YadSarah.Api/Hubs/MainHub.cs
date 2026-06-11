using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;

namespace YadSarah.Api.Hubs;

[Authorize]
public class MainHub : Hub
{
    public async Task JoinForm(string formId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"form_{formId}");

        // Broadcast presence update
        await Clients.Group($"form_{formId}").SendAsync("PresenceUpdate", new
        {
            formId,
            presentUsers = new[]
            {
                new
                {
                    userId = Context.UserIdentifier,
                    fullName = Context.User?.FindFirstValue("fullName") ?? "Unknown",
                    role = Context.User?.FindFirstValue(ClaimTypes.Role) ?? "Unknown",
                }
            }
        });
    }

    public async Task LeaveForm(string formId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"form_{formId}");
        await Clients.Group($"form_{formId}").SendAsync("PresenceUpdate", new
        {
            formId,
            presentUsers = Array.Empty<object>()
        });
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await base.OnDisconnectedAsync(exception);
    }

}
