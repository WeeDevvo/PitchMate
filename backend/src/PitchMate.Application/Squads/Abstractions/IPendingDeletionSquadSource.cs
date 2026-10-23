namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// The one read that can see a squad pending deletion: the squads a user owns that are deleted but not
/// yet purged, so the owner can find a squad to restore (Requirement 17.4).
/// <para>
/// Every other squad read hides a pending-deletion squad, so this source is scoped to the owner by
/// construction: it answers only for squads where the user holds the active owner membership, and it
/// returns nothing about any other squad. A member who is not the owner cannot learn that a squad they
/// belonged to was deleted, which keeps the existence concealment the rest of the API applies.
/// </para>
/// </summary>
public interface IPendingDeletionSquadSource
{
    /// <summary>
    /// Lists the squads <paramref name="userId"/> owns that are pending deletion with a purge instant
    /// still after <paramref name="now"/>, soonest purge first.
    /// </summary>
    /// <param name="userId">The user whose owned squads are read.</param>
    /// <param name="now">The current instant; a squad whose purge is due is not restorable and is left out.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    Task<IReadOnlyList<PendingDeletionSquad>> ListOwnedByAsync(
        Guid userId,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}
