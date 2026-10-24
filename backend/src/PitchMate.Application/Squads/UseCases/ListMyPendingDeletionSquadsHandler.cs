using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Lists the squads the caller owns that are deleted but still inside their grace period, so the owner
/// can reach a squad to restore it (Requirement 17.4). Every other squad read hides a pending-deletion
/// squad, so without this the restore route would be unreachable from a client.
/// <para>
/// The read is owner-scoped by its source: a non-owner, or a user with no squads, gets an empty list,
/// never a failure, so the response says nothing about any squad the caller does not own. A squad whose
/// purge instant has passed is left out because it can no longer be restored.
/// </para>
/// </summary>
public sealed class ListMyPendingDeletionSquadsHandler
{
    private readonly IPendingDeletionSquadSource _source;
    private readonly TimeProvider _clock;

    /// <summary>Creates the handler with the owner-scoped source and the clock it judges "not yet purged" by.</summary>
    public ListMyPendingDeletionSquadsHandler(IPendingDeletionSquadSource source, TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(clock);

        _source = source;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="ListMyPendingDeletionSquadsCommand"/>, returning the caller's restorable
    /// squads, soonest purge first. It has no failure case.
    /// </summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<IReadOnlyList<PendingDeletionSquad>>> HandleAsync(
        ListMyPendingDeletionSquadsCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        IReadOnlyList<PendingDeletionSquad> squads =
            await _source.ListOwnedByAsync(command.UserId, _clock.GetUtcNow(), cancellationToken);

        return Result<IReadOnlyList<PendingDeletionSquad>>.Ok(squads);
    }
}
