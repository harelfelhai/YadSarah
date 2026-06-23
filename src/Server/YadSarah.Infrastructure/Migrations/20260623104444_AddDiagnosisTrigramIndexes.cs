using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDiagnosisTrigramIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Diagnoses_EnglishName",
                table: "Diagnoses");

            migrationBuilder.DropIndex(
                name: "IX_Diagnoses_HebrewName",
                table: "Diagnoses");

            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,");

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_EnglishName",
                table: "Diagnoses",
                column: "EnglishName")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_HebrewName",
                table: "Diagnoses",
                column: "HebrewName")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Diagnoses_EnglishName",
                table: "Diagnoses");

            migrationBuilder.DropIndex(
                name: "IX_Diagnoses_HebrewName",
                table: "Diagnoses");

            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:pg_trgm", ",,");

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_EnglishName",
                table: "Diagnoses",
                column: "EnglishName");

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_HebrewName",
                table: "Diagnoses",
                column: "HebrewName");
        }
    }
}
