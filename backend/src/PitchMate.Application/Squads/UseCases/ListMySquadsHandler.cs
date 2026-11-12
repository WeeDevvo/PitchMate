using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Lists the squads the authenticated user belongs to (Requirement 16.4). The handler returns exactly
/// the set of non-deleted squads in which the user holds a membership — soft-deleted (pending-deletion)
/// squads are excluded by <see cref="ISquadRepository.ListForUserAsync"/> — and no other squad. For
/// each squad the user's own role and membership state are included so the squad list can render them,
/// with the facts its squad card shows, read through <see cref="ISquadCardSource"/>.
/// </summary>
public sealed class ListMySquadsHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadCardSource _cards;

    /// <summary>Creates the handler with the repositories and card source it reads through.</summary>
    public ListMySquadsHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        ISquadCardSource cards)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(cards);

        _squads = squads;
        _memberships = memberships;
        _cards = cards;
    }

    /// <summary>
    /// Handles a <see cref="ListMySquadsCommand"/>, returning the user's non-deleted squads with the
    /// role and state of their own membership in each, and each squad's card facts.
    /// </summary>
    /// <param name="command">The squad-list request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<IReadOnlyList<MySquadSummary>>> HandleAsync(
        ListMySquadsCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        IReadOnlyList<Squad> squads = await _squads.ListForUserAsync(command.UserId, cancellationToken);

        var summaries = new List<MySquadSummary>(squads.Count);
        foreach (Squad squad in squads)
        {
            SquadMembership? membership =
                await _memberships.GetByUserAndSquadAsync(command.UserId, squad.Id, cancellationToken);

            SquadCardFacts card = await _cards.ReadAsync(squad.Id, membership?.Id, cancellationToken);

            summaries.Add(new MySquadSummary(
                squad.Id,
                squad.Name,
                membership?.Role,
                membership?.State,
                card.PlayerCount,
                card.NextMatch is { } next
                    ? new MySquadNextMatch(next.MatchId, next.State, next.ScheduledAt, next.Location, next.CandidateDayCount)
                    : null,
                card.RecentForm));
        }

        return Result<IReadOnlyList<MySquadSummary>>.Ok(summaries);
    }
}
