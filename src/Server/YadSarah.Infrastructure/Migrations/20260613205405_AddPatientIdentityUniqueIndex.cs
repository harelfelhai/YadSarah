using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPatientIdentityUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Patients_IdentityType_IdentityNumber",
                table: "Patients",
                columns: new[] { "IdentityType", "IdentityNumber" },
                unique: true,
                filter: "\"IdentityNumber\" IS NOT NULL AND \"IdentityNumber\" <> ''");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Patients_IdentityType_IdentityNumber",
                table: "Patients");
        }
    }
}
