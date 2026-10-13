using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

// Both PitchMate.Domain.Matches and PitchMate.Domain.Squads define a Result / Result<T> triad;
// alias the match results so the unqualified names bind unambiguously in this handler.
using Result = PitchMate.Domain.Matches.Result;
using MatchListResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.MatchList>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Returns a squad's matches as a bounded, ordered <see cref="MatchList"/> to an active member of
/// that squad (Requirement 1.1, 1.2). The read resolves the requesting user's membership in the
/// squad the request names and gates through <see cref="MatchAuthorization.RequireActiveMember"/>,
/// which admits any <see cref="MembershipState.Active"/> membership of the squad — owner, admin,
/// plain member or active guest alike — and no other membership (Requirement 5.1).
/// <para>
/// <b>The gate runs before the query source.</b> Unlike the match-scoped reads, this read's URL
/// names the <em>squad</em>, so a caller holding no membership must not cause a match query at all
/// and must not learn whether the squad exists. A refused gate therefore returns the uniform
/// <see cref="MatchErrorCode.Unauthorized"/> failure having invoked the source zero times.
/// </para>
/// <para>
/// A <see langword="null"/> page from <see cref="IMatchListSource.ListForSquadAsync"/> means the
/// squad is not visible — it does not exist, or it is excluded by the soft-delete query filter
/// because it is within its deletion grace period — and yields the <b>same</b> uniform failure the
/// gate returns. That makes a squad that does not exist, a squad inside its grace period, and a
/// squad in which the caller holds no <c>Active</c> membership indistinguishable
/// (Requirement 5.9, 5.13). A <b>visible</b> squad with no admitted match is a success carrying zero
/// entries and a false truncation member, not a concealment (Requirement 1.11).
/// </para>
/// <para>
/// The handler <b>carries</b> the truncation signal rather than computing it: the decision belongs
/// to the source, which holds the <c>limit + 1</c>-th row, which is what keeps the bound inside the
/// database and out of the Api (Requirement 1.10, 11.4). The handler applies no state, date-range or
/// deletion filter of its own — the source's only exclusion is the existing global soft-delete
/// filter, so a match in every lifecycle state is admitted (Requirement 1.3).
/// </para>
/// </summary>
public sealed class GetMatchListHandler
{
    private readonly IMatchListSource _source;
    private readonly ISquadMembershipRepository _memberships;

    /// <summary>Creates the handler with the match list query source and the membership repository it reads through.</summary>
    public GetMatchListHandler(
        IMatchListSource source,
        ISquadMembershipRepository memberships)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(memberships);

        _source = source;
        _memberships = memberships;
    }

    /// <summary>
    /// Handles a <see cref="GetMatchListCommand"/>, returning the squad's bounded, ordered
    /// <see cref="MatchList"/> on success or the uniform <see cref="MatchErrorCode.Unauthorized"/>
    /// failure when the requester is not an active member of the named squad or the squad is not
    /// visible.
    /// </summary>
    /// <param name="command">The match list read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<MatchListResult> HandleAsync(
        GetMatchListCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Gate first, query second. The request names the squad, so a caller holding no active
        // membership must cause no match query and must learn nothing about the squad's existence
        // (Requirement 5.1, 5.9).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireActiveMember(acting);
        if (!gate.IsSuccess)
        {
            return MatchListResult.Fail(gate.Error!);
        }

        // One squad-scoped read composes the ordered, bounded entries and the truncation signal
        // (Requirement 1.12). A null page means the squad is not visible, and is refused with the
        // same uniform failure the gate returns so the two causes are indistinguishable
        // (Requirement 5.9).
        MatchListPage? page =
            await _source.ListForSquadAsync(command.SquadId, MatchListLimits.MaximumEntries, cancellationToken);

        if (page is null)
        {
            return MatchListResult.Fail(MatchAuthorization.RequireActiveMember(null).Error!);
        }

        // Carry the source's entries and its truncation decision through unchanged; the handler
        // neither reorders, re-filters nor recomputes the bound (Requirement 1.3, 1.10, 11.4).
        return MatchListResult.Ok(new MatchList(page.Entries, page.Truncated));
    }
}
