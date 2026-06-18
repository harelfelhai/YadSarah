using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FormSignedByLicense : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SignedByLicense",
                table: "MedicalForms",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SignedBySpecialistLicense",
                table: "MedicalForms",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SignedByLicense",
                table: "MedicalForms");

            migrationBuilder.DropColumn(
                name: "SignedBySpecialistLicense",
                table: "MedicalForms");
        }
    }
}
