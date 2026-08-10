using PitchMate.Application.LiveTracking;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Stats;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.LiveTracking;

/// <summary>
/// The real <see cref="IRichStatsSource"/> that replaces the no-data <c>EmptyRichStatsSource</c>,
/// computing a squad's rich statistics from its recorded event log rather than inventing storage. It
/// loads the accepted events across the squad's <c>Completed</c> matches through
/// <see cref="IMatchEventRepository.GetForSquadCompletedMatchesAsync"/> and drives the pure Domain
/// <see cref="MatchEventLog"/> projection to derive them — no statistics logic is re-implemented here
/// (Requirement 10.1, 10.6, 10.7, 12.4).
/// <para>
/// The seam is feature-gated: when the squad does not have <see cref="SquadFeature.LiveMatchTracking"/>
/// enabled (or the squad is absent), both reads report <see langword="null"/> — "no data" —
/// distinct from a zero value (Requirement 9.2). When the feature is enabled but no effective goal or
/// keeper detail exists across the squad's completed matches, <see cref="GetForMembershipAsync"/>
/// reports <see cref="RichStats"/> of <b>zero</b> (never <see langword="null"/>) so an enabled squad
/// degrades gracefully, while <see cref="GetTopScorerAsync"/> reports <see langword="null"/> when no
/// effective non-own-goal goal exists (Requirement 9.3, 10.6).
/// </para>
/// <para>
/// Per-match figures are the summed unit: each completed match's events drive
/// <see cref="MatchEventLog.ForMembership"/> independently (so a match's keeper stints and duration
/// stay scoped to that match) and the per-match <see cref="MatchRichStatistics"/> are summed across
/// the squad. A clean sheet is a completed match in which the membership kept at least one stint and
/// conceded no goal while keeping (Requirement 10.4). The squad top scorer pools the events across
/// completed matches, which is sound because retraction targeting keys on globally-unique
/// <c>Event_Id</c>s (Requirement 10.6).
/// </para>
/// </summary>
internal sealed class EventLogRichStatsSource(
    ISquadRepository squads,
    IMatchEventRepository matchEvents) : IRichStatsSource
{
    /// <inheritdoc />
    public async Task<RichStats?> GetForMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct)
    {
        // Feature-gate: a squad without LiveMatchTracking (or an absent squad) reports "no data"
        // (Requirement 9.2), distinct from the zero value an enabled-but-empty squad reports below.
        if (!await IsLiveTrackingEnabledAsync(squadId, ct).ConfigureAwait(false))
        {
            return null;
        }

        // Only the squad's Completed matches contribute (Requirement 10.7, 12.4); the repository join
        // has already excluded non-completed and cancelled matches.
        var events = await matchEvents.GetForSquadCompletedMatchesAsync(squadId, ct).ConfigureAwait(false);

        var goals = 0;
        var cleanSheets = 0;
        var goalsConcededAsKeeper = 0;
        var keeperMinutes = 0;

        // Sum the per-match figures. Each match's events are projected independently so keeper-stint
        // durations and the match-duration bound stay scoped to their own match.
        foreach (var perMatch in events.GroupBy(matchEvent => matchEvent.MatchId))
        {
            MatchRichStatistics matchStats = MatchEventLog.ForMembership(membershipId, perMatch);

            goals += matchStats.Goals;
            goalsConcededAsKeeper += matchStats.ConcededAsKeeper;
            keeperMinutes += matchStats.KeeperMinutes;

            // A clean sheet: kept at least one stint and conceded none while keeping (Requirement 10.4).
            if (matchStats.KeptAnyStint && matchStats.ConcededAsKeeper == 0)
            {
                cleanSheets++;
            }
        }

        // Enabled with no effective detail still reports zero, never null (Requirement 9.3, 10.1).
        return new RichStats(
            Goals: goals,
            CleanSheets: cleanSheets,
            GoalsConcededAsKeeper: goalsConcededAsKeeper,
            KeeperTime: TimeSpan.FromMinutes(keeperMinutes));
    }

    /// <inheritdoc />
    public async Task<Guid?> GetTopScorerAsync(Guid squadId, CancellationToken ct)
    {
        // Feature-gate: disabled (or absent) squad has no top scorer (Requirement 9.2).
        if (!await IsLiveTrackingEnabledAsync(squadId, ct).ConfigureAwait(false))
        {
            return null;
        }

        var events = await matchEvents.GetForSquadCompletedMatchesAsync(squadId, ct).ConfigureAwait(false);

        // Pooling events across the squad's completed matches is sound because retraction targeting
        // keys on globally-unique Event_Ids; null when no effective non-own-goal goal exists
        // (Requirement 10.6).
        return MatchEventLog.TopScorer(events);
    }

    private async Task<bool> IsLiveTrackingEnabledAsync(Guid squadId, CancellationToken ct)
    {
        Squad? squad = await squads.GetByIdAsync(squadId, ct).ConfigureAwait(false);
        return squad is not null && squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking);
    }
}
