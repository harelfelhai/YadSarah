using YadSarah.Domain.Entities;

namespace YadSarah.Application.Services;

/// <summary>
/// Field/section-level edit permissions for the medical form.
///
/// ⚠ This is the single place to change which role may edit which section.
/// The exact nurse mapping is still to be finalized by the client — adjust
/// <see cref="NurseEditable"/> below when the final list is provided.
///
/// Doctor / ShiftManager / Admin may edit every section by default.
/// </summary>
public static class FormSectionPolicy
{
    // All editable section keys (must match the client section keys).
    public static readonly IReadOnlyList<string> AllSections = new[]
    {
        "chiefComplaint", "presentIllness", "pastMedicalHistory", "allergies",
        "vitalSigns", "triage", "treatments", "physicalExam",
        "administrationOrders", "diagnoses", "discussionAndPlan",
        "dischargeRecommendations", "dischargeMedications", "orderedUnits", "routing",
    };

    // Sections a NURSE is allowed to edit. (Default — to be refined by client.)
    private static readonly HashSet<string> NurseEditable = new()
    {
        "chiefComplaint", "presentIllness", "pastMedicalHistory",
        "allergies", "vitalSigns", "triage", "treatments",
        "administrationOrders", "routing",
    };

    public static bool CanEdit(UserRole role, string section) => role switch
    {
        UserRole.Doctor or UserRole.ShiftManager or UserRole.Admin => true,
        UserRole.Nurse => NurseEditable.Contains(section),
        _ => false, // Reception and others cannot edit clinical sections
    };

    // Sections the role may edit — used by the API to inform the client.
    public static IEnumerable<string> EditableSections(UserRole role) =>
        AllSections.Where(s => CanEdit(role, s));
}
