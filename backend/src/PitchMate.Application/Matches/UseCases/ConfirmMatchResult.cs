namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successful match confirmation: the confirmed match's identity, its confirmed
/// kickoff instant, and the number of registered participants seeded from the members whose
/// availability response marks the confirmed day (Requirement 6.1, 6.5).
/// </summary>
/// <param name="MatchId">The identity of the confirmed match.</param>
/// <param name="ConfirmedDay">The confirmed day's UTC instant, now the match's scheduled date-and-time.</param>
/// <param name="ParticipantCount">The number of registered participants seeded on confirmation.</param>
public sealed record ConfirmMatchResult(
    Guid MatchId,
    DateTimeOffset ConfirmedDay,
    int ParticipantCount);
