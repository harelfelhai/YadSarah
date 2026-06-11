using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserName = table.Column<string>(type: "text", nullable: false),
                    EntityType = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    FieldName = table.Column<string>(type: "text", nullable: true),
                    OldValue = table.Column<string>(type: "text", nullable: true),
                    NewValue = table.Column<string>(type: "text", nullable: true),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IpAddress = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FormLocks",
                columns: table => new
                {
                    FormId = table.Column<Guid>(type: "uuid", nullable: false),
                    SectionName = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserName = table.Column<string>(type: "text", nullable: false),
                    LockedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FormLocks", x => new { x.FormId, x.SectionName });
                });

            migrationBuilder.CreateTable(
                name: "Patients",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IdentityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IdentityNumber = table.Column<string>(type: "text", nullable: true),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    FirstNameLatin = table.Column<string>(type: "text", nullable: true),
                    LastNameLatin = table.Column<string>(type: "text", nullable: true),
                    FatherName = table.Column<string>(type: "text", nullable: true),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: true),
                    BirthCountry = table.Column<string>(type: "text", nullable: true),
                    MaritalStatus = table.Column<string>(type: "text", nullable: true),
                    NumberOfChildren = table.Column<int>(type: "integer", nullable: true),
                    City = table.Column<string>(type: "text", nullable: true),
                    Street = table.Column<string>(type: "text", nullable: true),
                    HouseNumber = table.Column<string>(type: "text", nullable: true),
                    ZipCode = table.Column<string>(type: "text", nullable: true),
                    PoBox = table.Column<string>(type: "text", nullable: true),
                    PhoneMobile = table.Column<string>(type: "text", nullable: true),
                    PhoneHome = table.Column<string>(type: "text", nullable: true),
                    PhoneWork = table.Column<string>(type: "text", nullable: true),
                    PhoneExtra1 = table.Column<string>(type: "text", nullable: true),
                    PhoneExtra2 = table.Column<string>(type: "text", nullable: true),
                    Email = table.Column<string>(type: "text", nullable: true),
                    Fax = table.Column<string>(type: "text", nullable: true),
                    DigitalContactPerson = table.Column<string>(type: "text", nullable: true),
                    DigitalContactPhone = table.Column<string>(type: "text", nullable: true),
                    AcceptsDigitalInfo = table.Column<bool>(type: "boolean", nullable: false),
                    HealthFund = table.Column<string>(type: "text", nullable: true),
                    HealthFundBranch = table.Column<string>(type: "text", nullable: true),
                    FamilyDoctorName = table.Column<string>(type: "text", nullable: true),
                    ClinicPhone = table.Column<string>(type: "text", nullable: true),
                    ClinicFax = table.Column<string>(type: "text", nullable: true),
                    ClinicEmail = table.Column<string>(type: "text", nullable: true),
                    IsConfidential = table.Column<bool>(type: "boolean", nullable: false),
                    IsBlocked = table.Column<bool>(type: "boolean", nullable: false),
                    IsHonorBlocked = table.Column<bool>(type: "boolean", nullable: false),
                    AccountingCard = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Patients", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Username = table.Column<string>(type: "text", nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    FullName = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Visits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PatientId = table.Column<Guid>(type: "uuid", nullable: false),
                    QueueNumber = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ReceptionDepartment = table.Column<string>(type: "text", nullable: true),
                    AdmissionDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AdmissionTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    AdmissionMethod = table.Column<string>(type: "text", nullable: true),
                    AdmissionReason = table.Column<string>(type: "text", nullable: true),
                    AdmissionReasonFree = table.Column<string>(type: "text", nullable: true),
                    ArrivalMethod = table.Column<string>(type: "text", nullable: true),
                    AmbulanceCompany = table.Column<string>(type: "text", nullable: true),
                    ReferringSource = table.Column<string>(type: "text", nullable: true),
                    ReferringDoctor = table.Column<string>(type: "text", nullable: true),
                    IncidentNumber = table.Column<string>(type: "text", nullable: true),
                    VisitNumberAtStation = table.Column<string>(type: "text", nullable: true),
                    CommitmentNumber = table.Column<string>(type: "text", nullable: true),
                    CommitmentExpiryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ReceptionActivity = table.Column<string>(type: "text", nullable: true),
                    TotalToCollect = table.Column<decimal>(type: "numeric", nullable: true),
                    ExemptionReason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Visits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Visits_Patients_PatientId",
                        column: x => x.PatientId,
                        principalTable: "Patients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MedicalForms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VisitId = table.Column<Guid>(type: "uuid", nullable: false),
                    StationType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    FormType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    ChiefComplaint = table.Column<string>(type: "text", nullable: true),
                    PresentIllness = table.Column<string>(type: "text", nullable: true),
                    PastMedicalHistory = table.Column<string>(type: "text", nullable: true),
                    Triage = table.Column<string>(type: "text", nullable: true),
                    PhysicalExam = table.Column<string>(type: "text", nullable: true),
                    DiscussionAndPlan = table.Column<string>(type: "text", nullable: true),
                    DischargeRecommendations = table.Column<string>(type: "text", nullable: true),
                    OrderedUnits = table.Column<string>(type: "text", nullable: true),
                    AllergiesJson = table.Column<string>(type: "text", nullable: false),
                    VitalSignsJson = table.Column<string>(type: "text", nullable: false),
                    TreatmentsJson = table.Column<string>(type: "text", nullable: false),
                    AdministrationOrdersJson = table.Column<string>(type: "text", nullable: false),
                    DiagnosesJson = table.Column<string>(type: "text", nullable: false),
                    DischargeMedicationsJson = table.Column<string>(type: "text", nullable: false),
                    RoutingJson = table.Column<string>(type: "text", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MedicalForms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MedicalForms_Visits_VisitId",
                        column: x => x.VisitId,
                        principalTable: "Visits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_EntityType_EntityId",
                table: "AuditLogs",
                columns: new[] { "EntityType", "EntityId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_Timestamp",
                table: "AuditLogs",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_FormLocks_ExpiresAt",
                table: "FormLocks",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_MedicalForms_VisitId",
                table: "MedicalForms",
                column: "VisitId");

            migrationBuilder.CreateIndex(
                name: "IX_Patients_IdentityNumber",
                table: "Patients",
                column: "IdentityNumber");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Visits_PatientId",
                table: "Visits",
                column: "PatientId");

            migrationBuilder.CreateIndex(
                name: "IX_Visits_Status",
                table: "Visits",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditLogs");

            migrationBuilder.DropTable(
                name: "FormLocks");

            migrationBuilder.DropTable(
                name: "MedicalForms");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Visits");

            migrationBuilder.DropTable(
                name: "Patients");
        }
    }
}
