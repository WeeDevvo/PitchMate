using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Property test for the appearance-counting scope of the squad read's standing source
/// (api-response-contracts task 6.2), validating design <c>Property 20: Appearance counts are
/// completed-match-only and squad-scoped</c> against the real <c>EfMembershipStandingSource</c> SQL on
/// a Testcontainers PostgreSQL instance with the production EF migrations applied.
/// <para>
/// For any generated mix of completed and non-completed matches across <b>two</b> squads, the count the
/// source reports for a membership MUST equal that membership's appearances in completed matches of the
/// requested squad alone. Each generated case asserts, per squad and per membership:
/// </para>
/// <list type="bullet">
///   <item><description>the reported count equals the count derived from that squad's completed
///   kickoff lineups — so a non-completed match carrying a locked lineup contributes nothing;</description></item>
///   <item><description>a membership with no appearances and no rating is <b>absent</b> from the
///   dictionary (the interface's definition of "nothing to report"), rather than present with a
///   zero;</description></item>
///   <item><description>no key belongs to the other squad, and the μ/σ reported alongside the count is
///   exactly what was persisted for that membership;</description></item>
///   <item><description>every count is non-negative.</description></item>
/// </list>
/// <para>
/// <b>Non-vacuity.</b> The generator guarantees per case (see
/// <see cref="StandingScopeDatasetGenerators"/>) both completed and non-completed matches in both
/// squads, and memberships with expected counts of two, one and zero — and the test asserts each of
/// those facts about the seeded data before comparing, so it cannot pass on empty or uniform data. It
/// also plants one squad's membership in the other squad's completed lineup as a
/// <b>negative control</b>: since the domain keeps rosters within a squad, that planted row is the only
/// thing that makes the "of the requested squad alone" clause falsifiable, and a count that dropped the
/// squad filter would report one appearance too many for that membership.
/// </para>
/// <para>
/// Every case seeds into one migrated database created on first use (see
/// <see cref="MembershipStandingScopeHarness"/>), so the run neither creates a database per case nor
/// exhausts the socket range; the accumulated squads of earlier cases serve as further foreign squads
/// whose completed matches must not contribute. Each case already performs 32 per-membership
/// comparisons across its two squads, so the run clears several hundred logical checks. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MembershipStandingScopePropertyTests
{
    // Modest case count: each case seeds two squads of 16 memberships and 5..7 matches into the shared
    // database, and yields 32 per-membership comparisons plus the cross-squad control.
    private const int MaxTest = 10;

    private readonly MembershipStandingScopeHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MembershipStandingScopePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = new MembershipStandingScopeHarness(fixture);
    }

    // Feature: api-response-contracts, Property 20: For any mix of completed and non-completed matches
    // across two squads, the appearance count the standing source reports for a membership equals that
    // membership's appearances in completed matches of the requested squad alone.
    /// <summary>
    /// **Validates: Requirement 10.10**
    /// </summary>
    [Property(MaxTest = MaxTest, Arbitrary = new[] { typeof(StandingScopeDatasetArbitraries) })]
    public Property AppearanceCountsAreCompletedMatchOnlyAndSquadScoped(StatsDatasetSpec spec) =>
        RunAsync(async () =>
        {
            SeededStatsDataset seeded = await _harness.SeedAsync(spec);
            Assert.Equal(2, seeded.Squads.Count);

            SeededStatsDataset.SquadData first = seeded.SquadAt(0);
            SeededStatsDataset.SquadData second = seeded.SquadAt(1);

            Dictionary<Guid, int> expectedFirst = ExpectedAppearances(first);
            Dictionary<Guid, int> expectedSecond = ExpectedAppearances(second);

            // Non-vacuity: the generated data really does carry the mix the property is about.
            AssertGeneratedDataIsDiscriminating(first, expectedFirst);
            AssertGeneratedDataIsDiscriminating(second, expectedSecond);
            AssertSomeMembershipHasNothingToReport(first, expectedFirst, second, expectedSecond);

            // Negative control: plant each squad's first membership in a completed lineup of the other
            // squad, so the squad filter is the only thing keeping the counts right.
            await _harness.AppendToTeamRosterAsync(
                FirstCompletedTeamId(second), first.Memberships[0].MembershipId);
            await _harness.AppendToTeamRosterAsync(
                FirstCompletedTeamId(first), second.Memberships[0].MembershipId);

            await AssertSquadStandingAsync(first, expectedFirst);
            await AssertSquadStandingAsync(second, expectedSecond);

            return true;
        });

    /// <summary>
    /// Asserts the source's answer for one squad against the counts derived from that squad's completed
    /// kickoff lineups, including the absent-entry semantics and the squad-scoped key set.
    /// </summary>
    private async Task AssertSquadStandingAsync(
        SeededStatsDataset.SquadData squad, Dictionary<Guid, int> expected)
    {
        IReadOnlyDictionary<Guid, MembershipStanding> standing =
            await _harness.ListForSquadAsync(squad.SquadId);

        // Every key is one of this squad's memberships — never the other squad's, and never one of an
        // earlier generated case's squads.
        Assert.All(standing.Keys, id => Assert.Contains(id, expected.Keys));

        foreach (SeededStatsDataset.MembershipData member in squad.Memberships)
        {
            int expectedCount = expected[member.MembershipId];

            if (standing.TryGetValue(member.MembershipId, out MembershipStanding? reported))
            {
                Assert.True(
                    reported.Appearances >= 0,
                    $"Membership {member.MembershipId} reported a negative appearance count.");
                Assert.Equal(expectedCount, reported.Appearances);

                // The rating travels with the count, exactly as persisted (or absent when none).
                Assert.Equal(member.Mu, reported.Mu);
                Assert.Equal(member.Sigma, reported.Sigma);
            }
            else
            {
                // An absent entry means no appearances and no rating (Requirement 10.4).
                Assert.Equal(0, expectedCount);
                Assert.Null(member.Mu);
            }
        }
    }

    /// <summary>
    /// Asserts the generated squad really exercises the property: it has completed <em>and</em>
    /// non-completed matches, a membership sitting in a non-completed lineup it must not be counted for,
    /// and memberships whose expected counts are two, one and zero — so neither a count that ignores the
    /// completed restriction nor one that fails to accumulate could pass.
    /// </summary>
    private static void AssertGeneratedDataIsDiscriminating(
        SeededStatsDataset.SquadData squad, Dictionary<Guid, int> expected)
    {
        Assert.Contains(squad.Matches, match => match.State == MatchState.Completed);
        Assert.Contains(squad.Matches, match => match.State != MatchState.Completed);

        // At least one membership appears in a lineup of a non-completed match: the completed-only
        // restriction therefore has something to exclude.
        Dictionary<Guid, int> anyState = AppearancesIn(squad, completedOnly: false);
        Assert.Contains(
            expected.Keys,
            id => anyState[id] > expected[id]);

        Assert.Contains(expected.Values, count => count >= 2);
        Assert.Contains(expected.Values, count => count == 1);
        Assert.Contains(expected.Values, count => count == 0);
    }

    /// <summary>
    /// Asserts at least one membership across the two squads has nothing to report — no appearances and
    /// no rating — so the absent-entry branch of the comparison is reached in every case.
    /// </summary>
    private static void AssertSomeMembershipHasNothingToReport(
        SeededStatsDataset.SquadData first,
        Dictionary<Guid, int> expectedFirst,
        SeededStatsDataset.SquadData second,
        Dictionary<Guid, int> expectedSecond)
    {
        bool present =
            HasNothingToReport(first, expectedFirst) || HasNothingToReport(second, expectedSecond);

        Assert.True(
            present,
            "No generated membership had zero appearances and no rating, so the absent-entry assertion would be vacuous.");
    }

    private static bool HasNothingToReport(
        SeededStatsDataset.SquadData squad, Dictionary<Guid, int> expected) =>
        squad.Memberships.Any(member => expected[member.MembershipId] == 0 && member.Mu is null);

    /// <summary>The identity of the first team of the squad's first completed match.</summary>
    private static Guid FirstCompletedTeamId(SeededStatsDataset.SquadData squad) =>
        squad.Matches.First(match => match.State == MatchState.Completed).Teams[0].TeamId;

    /// <summary>
    /// The expected appearance count per membership of the squad: the number of that squad's completed
    /// matches whose kickoff lineup includes the membership, counted once per match.
    /// </summary>
    private static Dictionary<Guid, int> ExpectedAppearances(SeededStatsDataset.SquadData squad) =>
        AppearancesIn(squad, completedOnly: true);

    /// <summary>
    /// Counts each membership's lineup appearances across the squad's matches, either over completed
    /// matches only (the expected value) or over every match (used to prove the completed-only
    /// restriction actually excludes something).
    /// </summary>
    private static Dictionary<Guid, int> AppearancesIn(
        SeededStatsDataset.SquadData squad, bool completedOnly)
    {
        var counts = squad.Memberships.ToDictionary(member => member.MembershipId, _ => 0);

        foreach (SeededStatsDataset.MatchData match in squad.Matches)
        {
            if (completedOnly && match.State != MatchState.Completed)
            {
                continue;
            }

            foreach (Guid membershipId in match.Teams.SelectMany(team => team.Roster).Distinct())
            {
                if (counts.ContainsKey(membershipId))
                {
                    counts[membershipId]++;
                }
            }
        }

        return counts;
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the harness's asynchronous database work.
    /// Blocking is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
