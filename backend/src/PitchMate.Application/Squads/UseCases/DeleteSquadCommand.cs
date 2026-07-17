namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by a squad owner to delete their squad (Requirement 17.1). The acting user is
/// identified by their user identity and the target squad; the handler resolves that user's own
/// membership, requires it to be the active owner (Requirement 17.6), and soft-deletes the squad,
/// setting a purge instant of the clock instant plus the grace period.
/// <para>
/// <paramref name="GracePeriodDays"/> is the whole number of days between the soft-delete and the
/// purge; when <see langword="null"/> the squad's default grace period is applied, and a supplied
/// value is validated to the inclusive 1..90 range (Requirement 17.8). Deletion of an
/// already-soft-deleted squad is idempotent and leaves the existing purge instant unchanged
/// (Requirement 17.7).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the deletion.</param>
/// <param name="SquadId">The squad to soft-delete.</param>
/// <param name="GracePeriodDays">
/// The grace period in whole days (1..90); <see langword="null"/> applies the default of 30 days.
/// </param>
public sealed record DeleteSquadCommand(
    Guid ActingUserId,
    Guid SquadId,
    int? GracePeriodDays = null);
