namespace PitchMate.Domain.Matches;

/// <summary>
/// A typed match-lifecycle failure. <paramref name="Code"/> is the stable, switchable error kind;
/// <paramref name="Message"/> is human-readable diagnostic text only and is never parsed by callers.
/// </summary>
/// <param name="Code">The stable error classification.</param>
/// <param name="Message">Diagnostic description for logging.</param>
public sealed record MatchError(MatchErrorCode Code, string Message);
