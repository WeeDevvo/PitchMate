using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// What <see cref="IMatchDetailSource"/> reads for one match: everything a <see cref="MatchDetail"/>
/// carries except what the handler composes for the caller — the effective threshold and the caller's
/// own availability. It carries <see cref="SquadId"/> so the handler can resolve the acting membership
/// in the match's squad.
/// </summary>
/// <param name="MatchId">The identity of the match.</param>
/// <param name="SquadId">The owning squad.</param>
/// <param name="State">The match's lifecycle state.</param>
/// <param name="Location">The match's location, verbatim.</param>
/// <param name="CandidateDays">The candidate days as bare UTC instants, in stored order.</param>
/// <param name="ConfirmedDay">The confirmed day, or <see langword="null"/>.</param>
/// <param name="Participants">The participant views in ascending roster-position order, names already resolved.</param>
/// <param name="RecordedResult">The recorded result, or <see langword="null"/>.</param>
/// <param name="CompletedAt">The completion instant, or <see langword="null"/>.</param>
public sealed record MatchDetailProjection(
    Guid MatchId,
    Guid SquadId,
    MatchState State,
    string Location,
    IReadOnlyList<DateTimeOffset> CandidateDays,
    DateTimeOffset? ConfirmedDay,
    IReadOnlyList<ParticipantView> Participants,
    RecordedResultView? RecordedResult,
    DateTimeOffset? CompletedAt);
