using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;
using YadSarah.Api.Services;

namespace YadSarah.Api.Hubs;

[Authorize]
public class MainHub(FormPresenceService presence) : Hub
{
    public async Task JoinForm(string formId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"form_{formId}");

        var info = new UserInfo(
            UserId: Context.UserIdentifier ?? "",
            FullName: Context.User?.FindFirstValue("fullName") ?? "Unknown",
            Role: Context.User?.FindFirstValue(ClaimTypes.Role) ?? "Unknown"
        );
        presence.Add(formId, Context.ConnectionId, info);

        await BroadcastPresence(formId);
    }

    public async Task LeaveForm(string formId)
    {
        presence.Remove(formId, Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"form_{formId}");
        await BroadcastPresence(formId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        presence.RemoveConnection(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    private async Task BroadcastPresence(string formId)
    {
        var users = presence.GetPresent(formId)
            .Select(u => new { userId = u.UserId, fullName = u.FullName, role = u.Role });

        await Clients.Group($"form_{formId}").SendAsync("PresenceUpdate", new { formId, presentUsers = users });
    }
}
