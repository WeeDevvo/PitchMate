namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by a squad owner to reverse a soft-deletion before the squad's purge instant
/// (Requirement 17.4). The acting user is identified by their user identity and the target squad; the
/// handler resolves that user's own membership, requires it to be the active owner, clears the
/// deletion mark and purge instant, and restores the squad to its pre-deletion state.
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the reversal.</param>
/// <param name="SquadId">The soft-deleted squad to restore.</param>
public sealed record ReverseSquadDeletionCommand(
    Guid ActingUserId,
    Guid SquadId);
