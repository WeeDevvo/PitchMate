using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PitchMate.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMatchLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "match",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_id = table.Column<Guid>(type: "uuid", nullable: false),
                    state = table.Column<int>(type: "integer", nullable: false),
                    confirmed_day = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    candidate_days = table.Column<string>(type: "jsonb", nullable: false),
                    kickoff_lineup = table.Column<string>(type: "jsonb", nullable: true),
                    recorded_result = table.Column<string>(type: "jsonb", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_match", x => x.id);
                    table.ForeignKey(
                        name: "fk_match_squad_squad_id",
                        column: x => x.squad_id,
                        principalTable: "squad",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "membership_rating",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_membership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    mu = table.Column<double>(type: "double precision", nullable: false),
                    sigma = table.Column<double>(type: "double precision", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_membership_rating", x => x.id);
                    table.ForeignKey(
                        name: "fk_membership_rating_squad_membership_squad_membership_id",
                        column: x => x.squad_membership_id,
                        principalTable: "squad_membership",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "availability_response",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    match_id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_membership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    marked_days = table.Column<string>(type: "jsonb", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_availability_response", x => x.id);
                    table.ForeignKey(
                        name: "fk_availability_response_match_match_id",
                        column: x => x.match_id,
                        principalTable: "match",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "match_participant",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    match_id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_membership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    is_guest = table.Column<bool>(type: "boolean", nullable: false),
                    roster_position = table.Column<int>(type: "integer", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_match_participant", x => x.id);
                    table.ForeignKey(
                        name: "fk_match_participant_match_match_id",
                        column: x => x.match_id,
                        principalTable: "match",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "match_team",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    match_id = table.Column<Guid>(type: "uuid", nullable: false),
                    team_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    bib_flag = table.Column<bool>(type: "boolean", nullable: false),
                    roster = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_match_team", x => x.id);
                    table.ForeignKey(
                        name: "fk_match_team_match_match_id",
                        column: x => x.match_id,
                        principalTable: "match",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "rating_snapshot",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    match_id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_membership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    mu = table.Column<double>(type: "double precision", nullable: false),
                    sigma = table.Column<double>(type: "double precision", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_rating_snapshot", x => x.id);
                    table.ForeignKey(
                        name: "fk_rating_snapshot_match_match_id",
                        column: x => x.match_id,
                        principalTable: "match",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "fk_rating_snapshot_squad_membership_squad_membership_id",
                        column: x => x.squad_membership_id,
                        principalTable: "squad_membership",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "ix_availability_response_match_id_squad_membership_id",
                table: "availability_response",
                columns: new[] { "match_id", "squad_membership_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_match_squad_id",
                table: "match",
                column: "squad_id");

            migrationBuilder.CreateIndex(
                name: "ix_match_participant_match_id_squad_membership_id",
                table: "match_participant",
                columns: new[] { "match_id", "squad_membership_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_match_team_match_id",
                table: "match_team",
                column: "match_id");

            migrationBuilder.CreateIndex(
                name: "ix_membership_rating_squad_membership_id",
                table: "membership_rating",
                column: "squad_membership_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_rating_snapshot_match_id_squad_membership_id",
                table: "rating_snapshot",
                columns: new[] { "match_id", "squad_membership_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_rating_snapshot_squad_membership_id",
                table: "rating_snapshot",
                column: "squad_membership_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "availability_response");

            migrationBuilder.DropTable(
                name: "match_participant");

            migrationBuilder.DropTable(
                name: "match_team");

            migrationBuilder.DropTable(
                name: "membership_rating");

            migrationBuilder.DropTable(
                name: "rating_snapshot");

            migrationBuilder.DropTable(
                name: "match");
        }
    }
}
