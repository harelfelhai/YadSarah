using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YadSarah.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class VisitReceptionFieldsRework : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AdmissionMethod",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "AdmissionReasonFree",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "AmbulanceCompany",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ArrivalMethod",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "CommitmentExpiryDate",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "CommitmentNumber",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "IncidentNumber",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ReceptionActivity",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ReferringDoctor",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "ReferringSource",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "VisitNumberAtStation",
                table: "Visits");

            migrationBuilder.AlterColumn<string>(
                name: "ReceptionDepartment",
                table: "Visits",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "ExemptionReason",
                table: "Visits",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "AdmissionReason",
                table: "Visits",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "DepartmentAssignedByAi",
                table: "Visits",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "DepartmentCandidatesJson",
                table: "Visits",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "DepartmentConfidence",
                table: "Visits",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DiscountApprovedByName",
                table: "Visits",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DiscountApprovedByUserId",
                table: "Visits",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DiscountReason",
                table: "Visits",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Visits",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DepartmentAssignedByAi",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DepartmentCandidatesJson",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DepartmentConfidence",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DiscountApprovedByName",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DiscountApprovedByUserId",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "DiscountReason",
                table: "Visits");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Visits");

            migrationBuilder.AlterColumn<string>(
                name: "ReceptionDepartment",
                table: "Visits",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "ExemptionReason",
                table: "Visits",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "AdmissionReason",
                table: "Visits",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdmissionMethod",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdmissionReasonFree",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AmbulanceCompany",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ArrivalMethod",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CommitmentExpiryDate",
                table: "Visits",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommitmentNumber",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncidentNumber",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReceptionActivity",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReferringDoctor",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReferringSource",
                table: "Visits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VisitNumberAtStation",
                table: "Visits",
                type: "text",
                nullable: true);
        }
    }
}
