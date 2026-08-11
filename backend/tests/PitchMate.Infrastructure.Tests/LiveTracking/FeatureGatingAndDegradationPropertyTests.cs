using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Application.Stats;
using PitchMate.Domain.LiveTracking;
using PitchMate.Infrastructure.LiveTracking;
using Match = PitchMate.Domain.Matches.Match;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// Property-based test for live-tracking design Property 13 — live tracking is feature-gated and
/// degrades gracefully — validated against the two components that own the gate: the real
/// <see cref="RecordEventBatchHandler"/> recording path (Requirement 9.1) and the real
/// <see cref="EventLogRichStatsSource"/> statistics seam (Requirements 9.2, 9.3, 9.4), both driven over
/// hand-written in-memory fakes with no database and no mocking framework.
/// <para>
/// The four facets of the property, for any generated squad-level event log:
/// </para>
/// <list type="bullet">
/// <item>(9.1) When the squad's <c>LiveMatchTracking</c> flag is off, recording an event is rejected as
/// <see cref="LiveTrackingErrorCode.NotEnabled"/> and appends nothing.</item>
/// <item>(9.2) While the flag is off, the <see cref="IRichStatsSource"/> seam reports no rich statistics
/// (<see langword="null"/>) for every membership and no top scorer (<see langword="null"/>).</item>
/// <item>(9.3) While the flag is on but no effective goals or stints exist, the seam reports rich
/// statistics of <em>zero</em> (a non-null <see cref="RichStats"/>) and no top scorer — distinct from
/// omitting them.</item>
/// <item>(9.4) Disabling the flag after events were recorded retains those events, so re-enabling the
/// flag resumes reporting their rich statistics unchanged.</item>
/// </list>
/// <para>
/// The enabled reads are checked against an independent recomputation over the shared, pure
/// <see cref="MatchEventLog"/> projection (the same oracle the sibling statistics properties use),
/// summed across the squad's completed matches, so the seam is confirmed to surface exactly the
/// projected values when enabled and to gate them — never to alter them.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class FeatureGatingAndDegradationPropertyTests
{
    // Feature: live-tracking, Property 13: Live tracking is feature-gated and degrades gracefully -
    // recording an event is rejected as not-enabled when the squad's LiveMatchTracking flag is off
    // (appending nothing); while the flag is off the IRichStatsSource seam reports no rich statistics
    // for any membership and no top scorer; while the flag is on but no effective goals or stints exist
    // the seam reports rich statistics of zero and no top scorer - distinct from omitting them; and
    // disabling the flag after events were recorded retains those events so re-enabling resumes
    // reporting their rich statistics unchanged.
    // Validates: Requirements 9.1, 9.2, 9.3, 9.4
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(FeatureGatingArbitraries) })]
    [Trait("Property", "13")]
    public bool LiveTrackingIsFeatureGatedAndDegradesGracefully(RichStatsScenario scenario)
    {
        // (9.1) Recording against a squad with the flag off is rejected as not-enabled, appending
        // nothing. This gate is independent of the generated event log.
        if (!RecordingRejectedWhenFlagOff())
        {
            return false;
        }

        // (9.3) An enabled squad with no effective detail reports zero (never null) and no top scorer,
        // distinct from the "no data" null an off squad reports. Checked with a dedicated empty log so
        // the case is exercised on every iteration regardless of the generated data.
        if (!EnabledButEmptyReportsZeroNotNull(scenario.SquadId, scenario.Memberships))
        {
            return false;
        }

        // The seam under test over the generated, retained event log. The squad's own Id is immaterial;
        // the fake repositories key on the scenario's squad id.
        Squad squad = Squad.Create("The Squad").Value!;
        var squads = new FakeSquadRepository(scenario.SquadId, squad);
        var events = new FakeMatchEventRepository(scenario.Events);
        var source = new EventLogRichStatsSource(squads, events);

        // Enabled: the seam surfaces exactly the projected values (Requirement 9.3 non-null, 10.1).
        squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);

        var enabledStats = new Dictionary<Guid, RichStats?>();
        foreach (Guid membership in scenario.Memberships)
        {
            RichStats? actual = source.GetForMembershipAsync(scenario.SquadId, membership, CancellationToken.None)
                .GetAwaiter().GetResult();

            RichStats expected = ExpectedRichStats(membership, scenario.Events);
            if (actual is null || actual != expected)
            {
                return false;
            }

            enabledStats[membership] = actual;
        }

        Guid? enabledTopScorer = source.GetTopScorerAsync(scenario.SquadId, CancellationToken.None)
            .GetAwaiter().GetResult();
        if (enabledTopScorer != MatchEventLog.TopScorer(scenario.Events))
        {
            return false;
        }

        // (9.2) Disabled: every membership reports "no data" (null) and there is no top scorer.
        squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: false);
        foreach (Guid membership in scenario.Memberships)
        {
            RichStats? disabled = source.GetForMembershipAsync(scenario.SquadId, membership, CancellationToken.None)
                .GetAwaiter().GetResult();
            if (disabled is not null)
            {
                return false;
            }
        }

        if (source.GetTopScorerAsync(scenario.SquadId, CancellationToken.None).GetAwaiter().GetResult() is not null)
        {
            return false;
        }

        // (9.4) Re-enabling retains the stored events, so reporting resumes byte-for-byte unchanged.
        squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);
        foreach (Guid membership in scenario.Memberships)
        {
            RichStats? resumed = source.GetForMembershipAsync(scenario.SquadId, membership, CancellationToken.None)
                .GetAwaiter().GetResult();
            if (resumed != enabledStats[membership])
            {
                return false;
            }
        }

        return source.GetTopScorerAsync(scenario.SquadId, CancellationToken.None).GetAwaiter().GetResult()
            == enabledTopScorer;
    }

    /// <summary>
    /// (Requirement 9.1) Wires the real <see cref="RecordEventBatchHandler"/> over a draft match in a
    /// squad whose <c>LiveMatchTracking</c> flag is off, submits one valid goal as the active owner, and
    /// asserts the request is rejected as <see cref="LiveTrackingErrorCode.NotEnabled"/> with nothing
    /// appended and no unit-of-work commit.
    /// </summary>
    private static bool RecordingRejectedWhenFlagOff()
    {
        // A fresh squad with the flag left at its disabled default.
        Squad squad = Squad.Create("Off Squad").Value!;
        Guid squadId = squad.Id;

        var ownerUserId = Guid.NewGuid();
        SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;

        var anchor = new DateTimeOffset(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);
        Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, "Hackney Marshes", [anchor.AddDays(7)], anchor).Value!;

        var matches = new SingleMatchRepository(match);
        var memberships = new ConfiguredMembershipRepository([owner]);
        var squads = new FakeSquadRepository(squadId, squad);
        var events = new FakeMatchEventRepository();
        var unitOfWork = new CountingUnitOfWork();
        var currentUser = new FixedCurrentUserAccessor(ownerUserId);

        var handler = new RecordEventBatchHandler(matches, memberships, squads, events, unitOfWork, currentUser);

        var submission = new EventSubmission(Guid.CreateVersion7(), EventKind.GoalScored, 10, ScoringTeamId: Guid.NewGuid());
        var command = new RecordEventBatchCommand(match.Id, [submission]);

        var result = handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();

        return !result.IsSuccess
            && result.Error!.Code == LiveTrackingErrorCode.NotEnabled
            && events.TotalCount == 0
            && events.AppendedCount == 0
            && unitOfWork.SaveCallCount == 0;
    }

    /// <summary>
    /// (Requirement 9.3) An enabled squad with no effective detail reports a non-null zero
    /// <see cref="RichStats"/> for every membership and no top scorer — distinct from the "no data"
    /// null an off squad reports (Requirement 9.2).
    /// </summary>
    private static bool EnabledButEmptyReportsZeroNotNull(Guid squadId, IReadOnlyList<Guid> memberships)
    {
        Squad squad = Squad.Create("Enabled Empty").Value!;
        squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);

        var squads = new FakeSquadRepository(squadId, squad);
        var events = new FakeMatchEventRepository();
        var source = new EventLogRichStatsSource(squads, events);

        var zero = new RichStats(Goals: 0, CleanSheets: 0, GoalsConcededAsKeeper: 0, KeeperTime: TimeSpan.Zero);

        foreach (Guid membership in memberships)
        {
            RichStats? actual = source.GetForMembershipAsync(squadId, membership, CancellationToken.None)
                .GetAwaiter().GetResult();
            if (actual is null || actual != zero)
            {
                return false;
            }
        }

        return source.GetTopScorerAsync(squadId, CancellationToken.None).GetAwaiter().GetResult() is null;
    }

    /// <summary>
    /// The independent oracle for an enabled squad's summed rich statistics: the per-match
    /// <see cref="MatchEventLog.ForMembership"/> projection accumulated across the squad's completed
    /// matches — goals, clean sheets (kept a stint and conceded none), goals conceded as keeper, and
    /// keeper minutes — mirroring how <see cref="EventLogRichStatsSource"/> composes the seam value
    /// (Requirement 9.3, 10.1).
    /// </summary>
    private static RichStats ExpectedRichStats(Guid membership, IReadOnlyList<MatchEvent> events)
    {
        var goals = 0;
        var cleanSheets = 0;
        var goalsConcededAsKeeper = 0;
        var keeperMinutes = 0;

        foreach (IGrouping<Guid, MatchEvent> perMatch in events.GroupBy(e => e.MatchId))
        {
            MatchRichStatistics stats = MatchEventLog.ForMembership(membership, perMatch);
            goals += stats.Goals;
            goalsConcededAsKeeper += stats.ConcededAsKeeper;
            keeperMinutes += stats.KeeperMinutes;

            if (stats.KeptAnyStint && stats.ConcededAsKeeper == 0)
            {
                cleanSheets++;
            }
        }

        return new RichStats(
            Goals: goals,
            CleanSheets: cleanSheets,
            GoalsConcededAsKeeper: goalsConcededAsKeeper,
            KeeperTime: TimeSpan.FromMinutes(keeperMinutes));
    }
}
