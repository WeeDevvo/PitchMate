namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The outcome of a successful squad soft-deletion: the UTC instant at which the soft-deleted squad
/// becomes eligible for purge, so the owner knows how long the deletion remains reversible
/// (Requirement 17.1). For an idempotent re-deletion this carries the squad's existing purge instant,
/// left unchanged (Requirement 17.7).
/// </summary>
/// <param name="PurgeAt">The UTC instant at which the squad becomes eligible for purge.</param>
public sealed record DeleteSquadResult(DateTimeOffset PurgeAt);
