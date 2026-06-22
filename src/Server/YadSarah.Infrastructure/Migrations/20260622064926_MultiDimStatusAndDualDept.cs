using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MultiDimStatusAndDualDept : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SecondaryDepartment",
                table: "Visits",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Department",
                table: "MedicalForms",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TrackOrder",
                table: "MedicalForms",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CareSteps",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VisitId = table.Column<Guid>(type: "uuid", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ClinicianRole = table.Column<string>(type: "text", nullable: true),
                    Department = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TrackOrder = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CalledByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CalledByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CalledByRole = table.Column<string>(type: "text", nullable: true),
                    CalledRoom = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    CalledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    StartedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    StartedByRole = table.Column<string>(type: "text", nullable: true),
                    StartedRoom = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReferredByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReferredByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ReferredByRole = table.Column<string>(type: "text", nullable: true),
                    ReferredByDepartment = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CareSteps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CareSteps_Visits_VisitId",
                        column: x => x.VisitId,
                        principalTable: "Visits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CareSteps_VisitId",
                table: "CareSteps",
                column: "VisitId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CareSteps");

            migrationBuilder.DropColumn(
                name: "SecondaryDepartment",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "Department",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "TrackOrder",
                table: "MedicalForms");
        }
    }
}
