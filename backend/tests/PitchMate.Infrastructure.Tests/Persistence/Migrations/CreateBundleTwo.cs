using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace PitchMate.Infrastructure.Tests.Persistence.Migrations;

/// <summary>
/// Second migration of <see cref="BundleMigrationsDbContext"/>. Creates the <c>bundle_two</c> table.
/// Its identifier sorts after <see cref="CreateBundleOne"/>, so the migrator applies it second,
/// letting the tests assert the migrations are applied in order.
/// </summary>
[DbContext(typeof(BundleMigrationsDbContext))]
[Migration("20300101000002_CreateBundleTwo")]
public sealed class CreateBundleTwo : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql(
            "CREATE TABLE bundle_two (id integer NOT NULL, CONSTRAINT pk_bundle_two PRIMARY KEY (id));");

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql("DROP TABLE bundle_two;");

    /// <inheritdoc />
    protected override void BuildTargetModel(ModelBuilder modelBuilder)
    {
        // Raw-SQL migration: no target model is required to generate or apply the operations.
    }
}
