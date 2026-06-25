using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace PitchMate.Infrastructure.Tests.Persistence.Migrations;

/// <summary>
/// Second migration of <see cref="FailingMigrationsDbContext"/>, which deliberately fails partway
/// through its <c>Up</c>: it first creates the <c>failrun_two</c> table and then runs a statement
/// that references a table which does not exist, raising an error mid-migration. Because EF Core
/// applies the migration inside a transaction on PostgreSQL, the <c>failrun_two</c> creation is
/// rolled back with the failing statement, leaving no partial schema (Requirement 11.6) and this
/// migration unrecorded in history (Requirement 12.5).
/// </summary>
[DbContext(typeof(FailingMigrationsDbContext))]
[Migration("20300201000002_CreateFailingTwo")]
public sealed class CreateFailingTwo : Migration
{
    /// <summary>The table created before the failure; it must not survive the rolled-back migration.</summary>
    public const string PartialTableName = "failrun_two";

    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // First create a table so there is a partial change to roll back.
        migrationBuilder.Sql(
            "CREATE TABLE failrun_two (id integer NOT NULL, CONSTRAINT pk_failrun_two PRIMARY KEY (id));");

        // Then fail: reference a table that does not exist, raising a PostgreSQL error (42P01).
        migrationBuilder.Sql(
            "INSERT INTO table_that_does_not_exist_for_migration_failure (id) VALUES (1);");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql("DROP TABLE IF EXISTS failrun_two;");

    /// <inheritdoc />
    protected override void BuildTargetModel(ModelBuilder modelBuilder)
    {
        // Raw-SQL migration: no target model is required to generate or apply the operations.
    }
}
