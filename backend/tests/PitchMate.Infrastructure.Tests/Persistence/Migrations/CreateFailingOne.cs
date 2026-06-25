using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace PitchMate.Infrastructure.Tests.Persistence.Migrations;

/// <summary>
/// First (valid) migration of <see cref="FailingMigrationsDbContext"/>. Creates the
/// <c>failrun_one</c> table and commits successfully, so the tests can assert it stays applied and
/// intact after the following migration fails.
/// </summary>
[DbContext(typeof(FailingMigrationsDbContext))]
[Migration("20300201000001_CreateFailingOne")]
public sealed class CreateFailingOne : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql(
            "CREATE TABLE failrun_one (id integer NOT NULL, CONSTRAINT pk_failrun_one PRIMARY KEY (id));");

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql("DROP TABLE failrun_one;");

    /// <inheritdoc />
    protected override void BuildTargetModel(ModelBuilder modelBuilder)
    {
        // Raw-SQL migration: no target model is required to generate or apply the operations.
    }
}
