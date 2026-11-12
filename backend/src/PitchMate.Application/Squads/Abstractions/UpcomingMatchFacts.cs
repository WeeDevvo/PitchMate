using PitchMate.Domain.Matches;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// A squad's next open match as <see cref="ISquadCardSource"/> reports it: one not yet completed or
/// cancelled, preferring a match in progress, then the soonest by its confirmed day or, while still
/// gathering availability, its earliest candidate day.
/// </summary>
/// <param name="MatchId">The match's identity.</param>
/// <param name="State">The match's lifecycle state; never completed or cancelled.</param>
/// <param name="ScheduledAt">The confirmed day, or <see langword="null"/> while gathering availability.</param>
/// <param name="Location">The match's location.</param>
/// <param name="CandidateDayCount">How many candidate days the match was drafted with.</param>
public sealed record UpcomingMatchFacts(
    Guid MatchId,
    MatchState State,
    DateTimeOffset? ScheduledAt,
    string Location,
    int CandidateDayCount);
