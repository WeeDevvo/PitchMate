using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace PitchMate.Infrastructure.Tests.Persistence.Migrations;

/// <summary>
/// First migration of <see cref="BundleMigrationsDbContext"/>. Creates the <c>bundle_one</c> table
/// using raw SQL so the migration needs no target model. Its identifier sorts before
/// <see cref="CreateBundleTwo"/>, so the migrator applies it first.
/// </summary>
[DbContext(typeof(BundleMigrationsDbContext))]
[Migration("20300101000001_CreateBundleOne")]
public sealed class CreateBundleOne : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql(
            "CREATE TABLE bundle_one (id integer NOT NULL, CONSTRAINT pk_bundle_one PRIMARY KEY (id));");

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql("DROP TABLE bundle_one;");

    /// <inheritdoc />
    protected override void BuildTargetModel(ModelBuilder modelBuilder)
    {
        // Raw-SQL migration: no target model is required to generate or apply the operations.
    }
}
