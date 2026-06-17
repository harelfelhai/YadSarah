using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ShiftStatusAndWorkstations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TreatingUserId",
                table: "Visits",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TreatingUserName",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TreatingUserRole",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TreatmentRoom",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TreatmentStartedAt",
                table: "Visits",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Workstations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    RoomName = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    CurrentUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CurrentUserName = table.Column<string>(type: "text", nullable: true),
                    CurrentUserRole = table.Column<string>(type: "text", nullable: true),
                    LastLoginAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Workstations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Workstations_DeviceId",
                table: "Workstations",
                column: "DeviceId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Workstations");

            migrationBuilder.DropColumn(
                name: "TreatingUserId",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "TreatingUserName",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "TreatingUserRole",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "TreatmentRoom",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "TreatmentStartedAt",
                table: "Visits");
        }
    }
}
