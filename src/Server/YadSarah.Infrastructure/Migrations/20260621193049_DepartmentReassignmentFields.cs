using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DepartmentReassignmentFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DepartmentChangedAt",
                table: "Visits",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DepartmentChangedByName",
                table: "Visits",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DepartmentChangedByRole",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentChangedByUserId",
                table: "Visits",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DepartmentChangedAt",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DepartmentChangedByName",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DepartmentChangedByRole",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DepartmentChangedByUserId",
                table: "Visits");
        }
    }
}
