using YadSarah.Domain.Entities;

namespace YadSarah.Application.Services;

/// <summary>
/// Field/section-level edit permissions for the medical form.
///
/// ⚠ This is the single place to change which role may edit which section. Mirrored on the client
/// in constants/formPolicy.ts — keep the two in sync.
///
/// The nurse edits exactly her own set (<see cref="NurseEditable"/>). Doctor / MedStudent may edit
/// every section EXCEPT the nurse-only ones (<see cref="NurseOnly"/>, e.g. the nurse's reason-for-
/// referral, which the doctor must not overwrite). ShiftManager / Admin may edit everything.
/// </summary>
public static class FormSectionPolicy
{
    // All editable section keys (must match the client section keys).
    public static readonly IReadOnlyList<string> AllSections = new[]
    {
        "chiefComplaintNurse", "chiefComplaint", "presentIllness", "pastMedicalHistory", "allergies",
        "homeMedications", "vitalSigns", "triage", "treatments", "physicalExam",
        "administrationOrders", "diagnoses", "discussionAndPlan",
        "dischargeRecommendations", "dischargeMedications", "orderedUnits", "routing",
    };

    // Sections a NURSE / nursing-student is allowed to edit — exactly these seven.
    private static readonly HashSet<string> NurseEditable = new()
    {
        "chiefComplaintNurse", "allergies", "vitalSigns", "treatments",
        "administrationOrders", "orderedUnits", "diagnoses",
    };

    // Sections only the nurse track (and managers) may edit — the doctor/medstudent must NOT
    // overwrite them. Currently just the nurse's own reason-for-referral.
    private static readonly HashSet<string> NurseOnly = new()
    {
        "chiefComplaintNurse",
    };

    // Edit permission for a single role.
    private static bool CanEditSingle(UserRole role, string section) => role switch
    {
        // Managers may edit any section (keeps the post-sign edit-window override consistent).
        UserRole.ShiftManager or UserRole.Admin => true,
        // Doctors and medical students may edit any section EXCEPT the nurse-only ones.
        UserRole.Doctor or UserRole.MedStudent => !NurseOnly.Contains(section),
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
