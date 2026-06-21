namespace YadSarah.Application.Services;

/// <summary>
/// Computes the patient charge for a visit. Server-authoritative — the client cannot set
/// <see cref="Domain.Entities.Visit.TotalToCollect"/>; the controller calls this and stamps
/// the result.
///
/// TODO(pending): the real pricing table from the client drives this — keyed by admission
/// reason / health fund / exemption. Returns 0 until the table is wired in.
/// </summary>
public class PricingService
{
    public Task<decimal> CalculateAsync(
        string? admissionReason, string? healthFund, string? exemptionReason,
        bool hasApprovedDiscount, CancellationToken ct = default)
    {
        // TODO(pending): look up the client-supplied price table. By definition an exemption
        // or an approved discount can zero / reduce the charge — that logic lands here too.
        return Task.FromResult(0m);
    }
}
