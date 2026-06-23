using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDiagnosisCodeTrigramIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_Code_Trgm",
                table: "Diagnoses",
                column: "Code")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Diagnoses_Code_Trgm",
                table: "Diagnoses");
        }
    }
}
