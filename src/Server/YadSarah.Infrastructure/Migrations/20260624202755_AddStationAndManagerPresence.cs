using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStationAndManagerPresence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ManagerPresenceAt",
                table: "Visits",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ManagerPresenceName",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ManagerPresenceRoom",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ManagerPresenceState",
                table: "Visits",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "ManagerPresenceUserId",
                table: "Visits",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Station",
                table: "Users",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ManagerPresenceAt",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ManagerPresenceName",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ManagerPresenceRoom",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ManagerPresenceState",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ManagerPresenceUserId",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "Station",
                table: "Users");
        }
    }
}
