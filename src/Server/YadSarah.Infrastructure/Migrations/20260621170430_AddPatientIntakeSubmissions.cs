using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientIntakeSubmissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PatientIntakeSubmissions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IdentityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IdentityNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    FatherName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Gender = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: true),
                    City = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    Street = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    HouseNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    PhoneMobile = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    PhoneHome = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DigitalContactPerson = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    DigitalContactRelation = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    DigitalContactPhone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    AcceptsDigitalInfo = table.Column<bool>(type: "boolean", nullable: false),
                    HealthFund = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    AdmissionReason = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SourceIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PatientIntakeSubmissions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PatientIntakeSubmissions_DeviceId",
                table: "PatientIntakeSubmissions",
                column: "DeviceId");

            migrationBuilder.CreateIndex(
                name: "IX_PatientIntakeSubmissions_IdentityNumber",
                table: "PatientIntakeSubmissions",
                column: "IdentityNumber");

            migrationBuilder.CreateIndex(
                name: "IX_PatientIntakeSubmissions_Status",
                table: "PatientIntakeSubmissions",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_PatientIntakeSubmissions_SubmittedAt",
                table: "PatientIntakeSubmissions",
                column: "SubmittedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PatientIntakeSubmissions");
        }
    }
}
