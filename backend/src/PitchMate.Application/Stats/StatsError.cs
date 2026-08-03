namespace PitchMate.Application.Stats;

/// <summary>
/// A typed stats-read failure. <paramref name="Code"/> is the stable, switchable error kind that
/// callers and the Api edge branch on; <paramref name="Message"/> is human-readable diagnostic text
/// only and is never parsed by callers.
/// </summary>
/// <param name="Code">The stable error classification.</param>
/// <param name="Message">Diagnostic description for logging.</param>
public sealed record StatsError(StatsErrorCode Code, string Message);
