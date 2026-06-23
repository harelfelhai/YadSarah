using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDiagnosisCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Diagnoses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    HebrewName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    EnglishName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Diagnoses", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_Code",
                table: "Diagnoses",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_EnglishName",
                table: "Diagnoses",
                column: "EnglishName");

            migrationBuilder.CreateIndex(
                name: "IX_Diagnoses_HebrewName",
                table: "Diagnoses",
                column: "HebrewName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Diagnoses");
        }
    }
}
