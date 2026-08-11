namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// A typed live-tracking failure. <paramref name="Code"/> is the stable, switchable error kind;
/// <paramref name="Message"/> is human-readable diagnostic text only and is never parsed by callers.
/// Mirrors <see cref="PitchMate.Domain.Squads.SquadError"/>.
/// </summary>
/// <param name="Code">The stable error classification.</param>
/// <param name="Message">Diagnostic description for logging.</param>
public sealed record LiveTrackingError(LiveTrackingErrorCode Code, string Message);
