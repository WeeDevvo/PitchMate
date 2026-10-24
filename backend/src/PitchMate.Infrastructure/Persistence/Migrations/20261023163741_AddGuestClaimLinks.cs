using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PitchMate.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Guest claims move to one-time claim links (ADR 0003): a claim holds the hash of its link's secret
    /// and an expiry, the target user is unknown until someone accepts, and an open claim can be
    /// cancelled when a newer link replaces it.
    /// <para>
    /// Existing rows predate links, so none has a secret. Each gets a placeholder hash that no real
    /// secret can produce (real hashes are base64 and never contain <c>:</c>), unique per row so the new
    /// index holds, and an expiry equal to its creation instant. A claim still Pending (state 1) is
    /// cancelled (state 5), because nobody could ever accept it. Consented, Completed and Reversed rows
    /// are left as they are.
    /// </para>
    /// </summary>
    public partial class AddGuestClaimLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "target_user_id",
                table: "guest_claim",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "cancelled_at",
                table: "guest_claim",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "expires_at",
                table: "guest_claim",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<string>(
                name: "token_hash",
                table: "guest_claim",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql(
                "UPDATE guest_claim SET token_hash = 'legacy:' || id::text, expires_at = created_at;");

            migrationBuilder.Sql(
                "UPDATE guest_claim SET state = 5, cancelled_at = now() WHERE state = 1;");

            migrationBuilder.CreateIndex(
                name: "ix_guest_claim_token_hash",
                table: "guest_claim",
                column: "token_hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_guest_claim_token_hash",
                table: "guest_claim");

            // The old schema had no Cancelled state and required a target user. A claim nobody accepted
            // has no target to restore, so it goes; a cancelled claim that had one returns to Pending.
            migrationBuilder.Sql("DELETE FROM guest_claim WHERE target_user_id IS NULL;");
            migrationBuilder.Sql("UPDATE guest_claim SET state = 1 WHERE state = 5;");

            migrationBuilder.DropColumn(
                name: "cancelled_at",
                table: "guest_claim");

            migrationBuilder.DropColumn(
                name: "expires_at",
                table: "guest_claim");

            migrationBuilder.DropColumn(
                name: "token_hash",
                table: "guest_claim");

            migrationBuilder.AlterColumn<Guid>(
                name: "target_user_id",
                table: "guest_claim",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
