using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// The match-read-models chore ships <b>migration-free</b> and leaves the aggregate's write surface
/// alone (task 15.3). It adds no migration — the one permitted index-only exception is declined, since
/// PostgreSQL cannot index the scheduling-instant expression — and the EF model has no change pending
/// against the latest snapshot, so no table, column, index or configuration moved. The
/// <see cref="Match"/> aggregate's public operations are exactly those it had before the chore: the
/// reads added no mutating member, and <see cref="Match.ProduceTeamSheet"/> changed its signature but
/// remains a pure projection (asserted in <c>MatchTeamSheetGateTests</c>).
/// <para><b>Validates: Requirements 11.6, 11.7, 11.8, 11.11.</b></para>
/// </summary>
public sealed class MatchReadModelsMigrationFreeTests
{
    /// <summary>The latest migration before the chore; the chore adds none after it.</summary>
    private const string LatestMigration = "20260810155804_AddMatchEvent";

    /// <summary>The aggregate's public operations before the chore, pinned so a new one fails by name.</summary>
    private static readonly string[] MatchOperations =
    [
        "AddParticipant", "ApplyTeamProposal", "Cancel", "ClearAvailability", "Complete", "ComputeAvailabilityTally",
        "Confirm", "CreateDraft", "DeriveOutcome", "GetAvailabilityResponse", "Lock", "MoveParticipant",
        "ProduceTeamSheet", "RecordResult", "RemoveParticipant", "SetBibTeam", "SetTeamName", "Start",
        "SubmitAvailability",
    ];

    [Fact]
    public void NoMigrationIsAddedAndNoModelChangeIsPending()
    {
        using PitchMateDbContext context = CreateContext();

        List<string> migrations = [.. context.Database.GetMigrations()];

        Assert.Equal(LatestMigration, migrations[^1]);
        Assert.Equal(5, migrations.Count);
        Assert.False(context.Database.HasPendingModelChanges(), "The EF model differs from the latest migration snapshot.");
    }

    [Fact]
    public void TheMatchAggregateGainedNoPublicOperation()
    {
        IEnumerable<string> operations = typeof(Match)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(static method => !method.IsSpecialName)
            .Select(static method => method.Name)
            .Distinct();

        Assert.Equal(MatchOperations.Order(StringComparer.Ordinal), operations.Order(StringComparer.Ordinal));
    }

    /// <summary>A production context over a connection string that is never opened.</summary>
    private static PitchMateDbContext CreateContext() =>
        new(
            MigrationTestSupport.BuildContextOptions("Host=localhost;Database=never_opened;Username=x;Password=x"),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());
}
