using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PitchMate.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSquadsAndMembership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "squad",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    purge_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("pk_squad", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "invite",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    state = table.Column<int>(type: "integer", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("pk_invite", x => x.id);
                    table.ForeignKey(
                        name: "fk_invite_squad_squad_id",
                        column: x => x.squad_id,
                        principalTable: "squad",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "squad_feature_flag",
                columns: table => new
                {
                    feature = table.Column<int>(type: "integer", nullable: false),
                    squad_id = table.Column<Guid>(type: "uuid", nullable: false),
                    is_enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_squad_feature_flag", x => new { x.squad_id, x.feature });
                    table.ForeignKey(
                        name: "fk_squad_feature_flag_squad_squad_id",
                        column: x => x.squad_id,
                        principalTable: "squad",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "squad_membership",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    squad_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    role = table.Column<int>(type: "integer", nullable: true),
                    state = table.Column<int>(type: "integer", nullable: false),
                    display_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    display_name_normalized = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    skill_tier = table.Column<int>(type: "integer", nullable: true),
                    claim_completed = table.Column<bool>(type: "boolean", nullable: false),
                    lawful_basis_acknowledged_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("pk_squad_membership", x => x.id);
                    table.CheckConstraint("ck_squad_membership_backing", "(user_id IS NULL) = (role IS NULL)");
                    table.ForeignKey(
                        name: "fk_squad_membership_squad_squad_id",
                        column: x => x.squad_id,
                        principalTable: "squad",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "guest_claim",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    membership_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    state = table.Column<int>(type: "integer", nullable: false),
                    consent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    reversed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("pk_guest_claim", x => x.id);
                    table.ForeignKey(
                        name: "fk_guest_claim_squad_membership_membership_id",
                        column: x => x.membership_id,
                        principalTable: "squad_membership",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_guest_claim_membership_id",
                table: "guest_claim",
                column: "membership_id");

            migrationBuilder.CreateIndex(
                name: "ix_invite_squad_id",
                table: "invite",
                column: "squad_id");

            migrationBuilder.CreateIndex(
                name: "ix_invite_token_hash",
                table: "invite",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_squad_membership_squad_id_display_name_normalized",
                table: "squad_membership",
                columns: new[] { "squad_id", "display_name_normalized" },
                unique: true,
                filter: "display_name_normalized IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_squad_membership_squad_id_owner",
                table: "squad_membership",
                column: "squad_id",
                unique: true,
                filter: "role = 1");

            migrationBuilder.CreateIndex(
                name: "ix_squad_membership_squad_id_user_id",
                table: "squad_membership",
                columns: new[] { "squad_id", "user_id" },
                unique: true,
                filter: "user_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "guest_claim");

            migrationBuilder.DropTable(
                name: "invite");

            migrationBuilder.DropTable(
                name: "squad_feature_flag");

            migrationBuilder.DropTable(
                name: "squad_membership");

            migrationBuilder.DropTable(
                name: "squad");
        }
    }
}
