namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// xUnit collection definition that shares a single <see cref="PostgreSqlContainerFixture"/>
/// (one PostgreSQL container and one created schema) across every persistence property and
/// integration test class added by tasks 5.2–5.8. Test classes opt in with
/// <c>[Collection(PostgreSqlCollection.Name)]</c>.
/// </summary>
[CollectionDefinition(Name)]
public sealed class PostgreSqlCollection : ICollectionFixture<PostgreSqlContainerFixture>
{
    /// <summary>The collection name test classes reference via <c>[Collection(...)]</c>.</summary>
    public const string Name = "PostgreSql";
}
