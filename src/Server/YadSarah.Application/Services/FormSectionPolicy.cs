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
        "homeMedications", "vitalSigns", "triage", "treatments", "physicalExam",
        "administrationOrders", "diagnoses", "discussionAndPlan",
        "dischargeRecommendations", "dischargeMedications", "orderedUnits", "routing",
    };

    // Sections a NURSE is allowed to edit. (Default — to be refined by client.)
    private static readonly HashSet<string> NurseEditable = new()
    {
        "chiefComplaint", "presentIllness", "pastMedicalHistory",
        "allergies", "homeMedications", "vitalSigns", "triage", "treatments",
        "administrationOrders", "routing",
    };

    // Edit permission for a single role.
    private static bool CanEditSingle(UserRole role, string section) => role switch
    {
        // Doctors, managers and medical students may edit any section.
        UserRole.Doctor or UserRole.ShiftManager or UserRole.Admin or UserRole.MedStudent => true,
        // Nurses and nursing students are limited to the nurse-editable sections.
        UserRole.Nurse or UserRole.NursingStudent => NurseEditable.Contains(section),
        _ => false, // Reception, LabStaff (view-only) and others cannot edit clinical sections
    };

    // A user may edit a section if ANY of their roles permits it (permissions = union).
    public static bool CanEdit(IReadOnlyCollection<UserRole> roles, string section) =>
        roles.Any(r => CanEditSingle(r, section));

    // Sections the user's roles may edit — used by the API to inform the client.
    public static IEnumerable<string> EditableSections(IReadOnlyCollection<UserRole> roles) =>
        AllSections.Where(s => CanEdit(roles, s));
}
