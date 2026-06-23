using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDoctorClaim : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ClaimedAt",
                table: "CareSteps",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ClaimedByName",
                table: "CareSteps",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClaimedByUserId",
                table: "CareSteps",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClaimedAt",
                table: "CareSteps");

            migrationBuilder.DropColumn(
                name: "ClaimedByName",
                table: "CareSteps");

            migrationBuilder.DropColumn(
                name: "ClaimedByUserId",
                table: "CareSteps");
        }
    }
}
