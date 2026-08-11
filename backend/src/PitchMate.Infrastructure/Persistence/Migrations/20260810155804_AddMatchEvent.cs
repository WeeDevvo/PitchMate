using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PitchMate.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMatchEvent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "match_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    match_id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    minute = table.Column<int>(type: "integer", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    goal_retracted_event_target_event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    scoring_team_id = table.Column<Guid>(type: "uuid", nullable: true),
                    scorer_membership_id = table.Column<Guid>(type: "uuid", nullable: true),
                    own_goal = table.Column<bool>(type: "boolean", nullable: true),
                    target_event_id = table.Column<Guid>(type: "uuid", nullable: true),
                    keeper_membership_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kept_team_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: true),
                    updated_by = table.Column<string>(type: "text", nullable: true),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_match_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_match_events_squad_squad_id",
                        column: x => x.squad_id,
                        principalTable: "squad",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "ix_match_events_match_id",
                table: "match_events",
                column: "match_id");

            migrationBuilder.CreateIndex(
                name: "ix_match_events_squad_id",
                table: "match_events",
                column: "squad_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "match_events");
        }
    }
}
