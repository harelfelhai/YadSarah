using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class QueueLetterPerDepartment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_QueueCounters",
                table: "QueueCounters");

            migrationBuilder.AddColumn<string>(
                name: "QueueLetter",
                table: "Visits",
                type: "character varying(4)",
                maxLength: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QueueLetter",
                table: "QueueCounters",
                type: "character varying(4)",
                maxLength: 4,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddPrimaryKey(
                name: "PK_QueueCounters",
                table: "QueueCounters",
                columns: new[] { "DateKey", "QueueLetter" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_QueueCounters",
                table: "QueueCounters");

            migrationBuilder.DropColumn(
                name: "QueueLetter",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "QueueLetter",
                table: "QueueCounters");

            migrationBuilder.AddPrimaryKey(
                name: "PK_QueueCounters",
                table: "QueueCounters",
                column: "DateKey");
        }
    }
}
