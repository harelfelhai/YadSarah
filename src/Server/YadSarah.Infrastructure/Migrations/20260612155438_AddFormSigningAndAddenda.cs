using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddFormSigningAndAddenda : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AddendaJson",
                table: "MedicalForms",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "FieldEditsJson",
                table: "MedicalForms",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "IsSigned",
                table: "MedicalForms",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "SignedAt",
                table: "MedicalForms",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SignedByName",
                table: "MedicalForms",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SignedByUserId",
                table: "MedicalForms",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AddendaJson",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "FieldEditsJson",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "IsSigned",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "SignedAt",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "SignedByName",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "SignedByUserId",
                table: "MedicalForms");
        }
    }
}
