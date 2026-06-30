using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddErrorReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ErrorReports",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Severity = table.Column<string>(type: "text", nullable: false),
                    CorrelationId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Message = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Stack = table.Column<string>(type: "character varying(16000)", maxLength: 16000, nullable: true),
                    ComponentStack = table.Column<string>(type: "character varying(16000)", maxLength: 16000, nullable: true),
                    RouteUrl = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    UserAgent = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UserRole = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IpAddress = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OccurrenceCount = table.Column<int>(type: "integer", nullable: false),
                    FirstSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    AdminNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ErrorReports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ErrorReports_CorrelationId",
                table: "ErrorReports",
                column: "CorrelationId");

            migrationBuilder.CreateIndex(
                name: "IX_ErrorReports_Fingerprint",
                table: "ErrorReports",
                column: "Fingerprint");

            migrationBuilder.CreateIndex(
                name: "IX_ErrorReports_LastSeenAt",
                table: "ErrorReports",
                column: "LastSeenAt");

            migrationBuilder.CreateIndex(
                name: "IX_ErrorReports_Severity",
                table: "ErrorReports",
                column: "Severity");

            migrationBuilder.CreateIndex(
                name: "IX_ErrorReports_Source",
                table: "ErrorReports",
                column: "Source");

            migrationBuilder.CreateIndex(
                name: "IX_ErrorReports_Status",
                table: "ErrorReports",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ErrorReports");
        }
    }
}
