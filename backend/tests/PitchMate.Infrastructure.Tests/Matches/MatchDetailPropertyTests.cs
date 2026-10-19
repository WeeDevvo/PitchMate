using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using MembershipState = PitchMate.Domain.Squads.MembershipState;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Model-based property tests for the match detail read (match-read-models tasks 10.10–10.12), comparing
/// the real <c>EfMatchDetailSource</c> SQL and <see cref="GetMatchDetailHandler"/> over the production EF
/// gateways on Testcontainers PostgreSQL against <see cref="MatchDetailReferenceOracle"/>.
/// <para>
/// One lazily migrated database for the class (see <see cref="MatchListSourceHarness"/>); each case
/// seeds fresh squads beside the earlier cases' ones. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchDetailPropertyTests
{
    private const int MaxTest = 10;

    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public MatchDetailPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "match_detail_properties");
    }

    // Feature: match-read-models, Property 6: The detail projection equals its specification, and
    // agrees with the list.
    /// <summary>
    /// **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7, 2.10, 2.11, 2.12, 13.10** — for every admitted
    /// match of every squad, the source's projection and the handler's detail are structurally equal to
    /// the oracle's (squad from the match, views in strictly ascending roster position under add-and-
    /// remove histories, a count equal to the views, the effective threshold, the completion instant
    /// exactly when completed), and the list and the detail agree on state, location, confirmed day,
    /// candidate days where both carry them, participant count and presence of a recorded result.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property DetailProjectionEqualsItsSpecificationAndAgreesWithTheList() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            // Non-vacuity: a gapped roster and a participant-less match are present.
            List<Match> admitted = [.. seeded.Squads.SelectMany(static squad => squad.Admitted)];
            Assert.Contains(admitted, static match => HasGaps(match));
            Assert.Contains(admitted, static match => match.Participants.Count == 0);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                SquadMembership caller = Callers(squad).First();
                MatchListPage? page = await _harness.ListForSquadAsync(squad.SquadId, MatchListLimits.MaximumEntries);
                Assert.NotNull(page);

                foreach (Match match in squad.Admitted)
                {
                    MatchDetailProjection expected = MatchDetailReferenceOracle.Projection(squad, match);

                    MatchDetailReferenceOracle.AssertAgrees(expected, await _harness.FindDetailAsync(match.Id));

                    Result<MatchDetail> result = await _harness.GetDetailAsync(caller.UserId!.Value, match.Id);
                    Assert.True(result.IsSuccess);
                    MatchDetail detail = result.Value!;
                    MatchDetailReferenceOracle.AssertAgrees(
                        expected, MatchDetailReferenceOracle.CallerAvailabilityOf(squad, match.Id, caller.Id), detail);

                    IReadOnlyList<int> positions = [.. detail.Participants.Select(static view => view.RosterPosition)];
                    Assert.True(positions.Zip(positions.Skip(1)).All(static pair => pair.First < pair.Second));

                    AssertAgreesWithTheList(page!.Entries.Single(entry => entry.MatchId == match.Id), detail);
                }
            }

            return true;
        }));

    // Feature: match-read-models, Property 8: A stored response marking nothing differs from no stored
    // response in the boolean alone.
    /// <summary>
    /// **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 13.12** — for each squad's first admitted match,
    /// every member who can call reads their own availability: a response marking no day is
    /// <c>(true, [])</c>, no response is <c>(false, [])</c> — differing in the boolean alone — and any
    /// stored response reports <c>true</c> with exactly the days it marks.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property StoredNothingDiffersFromNoResponseInTheBooleanAlone() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads.Where(static squad => squad.Admitted.Count > 0))
            {
                Match match = squad.Admitted[0];
                var reported = new Dictionary<Guid, CallerAvailability>();

                foreach (SquadMembership caller in Callers(squad))
                {
                    Result<MatchDetail> result = await _harness.GetDetailAsync(caller.UserId!.Value, match.Id);
                    CallerAvailability availability = result.Value!.CallerAvailability;

                    Assert.NotNull(availability.MarkedDays);
                    CallerAvailability expected = MatchDetailReferenceOracle.CallerAvailabilityOf(squad, match.Id, caller.Id);
                    Assert.Equal(expected.HasStoredResponse, availability.HasStoredResponse);
                    Assert.Equal(expected.MarkedDays.Order(), availability.MarkedDays.Order());

                    reported[caller.Id] = availability;
                }

                // Members 1 and 2 of the pool: a stored response marking nothing, and no response.
                CallerAvailability markedNothing = reported[squad.Memberships[1].Id];
                CallerAvailability noResponse = reported[squad.Memberships[2].Id];

                Assert.True(markedNothing.HasStoredResponse);
                Assert.False(noResponse.HasStoredResponse);
                Assert.Empty(markedNothing.MarkedDays);
                Assert.Empty(noResponse.MarkedDays);
            }

            return true;
        }));

    // Feature: match-read-models, Property 9: The caller's availability is the caller's own, unfiltered,
    // and agrees with the tally.
    /// <summary>
    /// **Validates: Requirements 3.1, 3.7, 3.8, 3.10, 13.11** — for each squad's first admitted match and
    /// every member who can call, the reported marked days are a set of candidate days equal to the
    /// candidate days in whose tally entry that member appears; and removing another member's stored
    /// response leaves the reported value unchanged.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property CallersAvailabilityIsTheirOwnAndAgreesWithTheTally() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads.Where(static squad => squad.Admitted.Count > 0))
            {
                Match match = squad.Admitted[0];
                IReadOnlySet<DateTimeOffset> candidateDays = match.CandidateDays.Select(static day => day.Instant).ToHashSet();
                List<SquadMembership> callers = [.. Callers(squad)];

                // Non-vacuity: a member marking days and a member marking none are among the callers.
                Assert.Contains(callers, caller => squad.ResponseOf(match.Id, caller.Id)?.MarkedDays.Count > 0);
                Assert.Contains(callers, caller => squad.ResponseOf(match.Id, caller.Id) is { MarkedDays.Count: 0 });

                Result<AvailabilityTally> tally = await _harness.GetTallyAsync(callers[0].UserId!.Value, squad.SquadId, match.Id);
                Assert.True(tally.IsSuccess);

                var before = new Dictionary<Guid, IReadOnlyList<DateTimeOffset>>();

                foreach (SquadMembership caller in callers)
                {
                    IReadOnlyList<DateTimeOffset> marked =
                        (await _harness.GetDetailAsync(caller.UserId!.Value, match.Id)).Value!.CallerAvailability.MarkedDays;

                    Assert.All(marked, day => Assert.Contains(day, candidateDays));

                    IEnumerable<DateTimeOffset> tallied = tally.Value!.Days
                        .Where(day => day.AvailableMemberIds.Contains(caller.Id))
                        .Select(static day => day.Day);
                    Assert.Equal(tallied.Order(), marked.Order());

                    before[caller.Id] = marked;
                }

                // Change another member's stored response: member 0 (who marks days) withdraws it.
                Guid changed = squad.Memberships[0].Id;
                await _harness.RemoveResponseAsync(match.Id, changed);

                foreach (SquadMembership caller in callers.Where(caller => caller.Id != changed))
                {
                    IReadOnlyList<DateTimeOffset> after =
                        (await _harness.GetDetailAsync(caller.UserId!.Value, match.Id)).Value!.CallerAvailability.MarkedDays;
                    Assert.Equal(before[caller.Id].Order(), after.Order());
                }
            }

            return true;
        }));

    /// <summary>The list and the detail agree on the members both report (Requirement 2.11).</summary>
    private static void AssertAgreesWithTheList(MatchListEntry entry, MatchDetail detail)
    {
        Assert.Equal(entry.State, detail.State);
        Assert.Equal(entry.Location, detail.Location);
        Assert.Equal(entry.ConfirmedDay, detail.ConfirmedDay);
        Assert.Equal(entry.ParticipantCount, detail.ParticipantCount);
        Assert.Equal(entry.RecordedResult is not null, detail.RecordedResult is not null);

        if (entry.CandidateDays.Count > 0)
        {
            Assert.Equal(entry.CandidateDays, detail.CandidateDays);
        }
    }

    /// <summary>The squad's members who can call: registered, active and not anonymised, in pool order.</summary>
    private static IEnumerable<SquadMembership> Callers(SeededMatchListDataset.SquadData squad) =>
        squad.Memberships.Where(static membership => membership.UserId is not null && membership.State == MembershipState.Active);

    private static bool HasGaps(Match match)
    {
        List<int> positions = [.. match.Participants.Select(static participant => participant.RosterPosition).Order()];
        return positions.Count > 0 && positions[^1] - positions[0] + 1 > positions.Count;
    }

    /// <summary>Bridges FsCheck's synchronous property model to the harness's asynchronous database work.</summary>
    private static bool RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult();
}
