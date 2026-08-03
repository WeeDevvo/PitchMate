using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

// Both PitchMate.Domain.Matches and PitchMate.Domain.Squads define a Result / Result<T> triad;
// alias the match results so the unqualified names bind unambiguously in this handler.
using Result = PitchMate.Domain.Matches.Result;
using TeamSheetResult = PitchMate.Domain.Matches.Result<PitchMate.Domain.Matches.TeamSheet>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Returns a match's <see cref="TeamSheet"/> to an active member of the match's squad
/// (Requirement 9.1, 9.2). The read is squad-scoped and non-disclosing: it loads the match,
/// resolves the requesting user's membership in that match's squad, and gates through
/// <see cref="MatchAuthorization.RequireActiveMember"/>. A request for a match that does not exist,
/// and a request by an inactive membership or a non-member, both yield the single uniform
/// authorisation failure, so a rejection discloses no team-sheet content and never reveals whether
/// the match exists (Requirement 9.4, 9.5). On success the sheet is projected by the pure Domain
/// <see cref="Match.ProduceTeamSheet"/>, which requires the match to be in
/// <see cref="MatchState.TeamsRolled"/> and otherwise returns an
/// <see cref="MatchErrorCode.InvalidState"/> failure (Requirement 9.3).
/// </summary>
public sealed class GetTeamSheetHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;

    /// <summary>Creates the handler with the match and membership repositories it reads through.</summary>
    public GetTeamSheetHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);

        _matches = matches;
        _memberships = memberships;
    }

    /// <summary>
    /// Handles a <see cref="GetTeamSheetCommand"/>, returning the projected <see cref="TeamSheet"/>
    /// on success or the uniform <see cref="MatchErrorCode.Unauthorized"/> failure when the match is
    /// absent or the requester is not an active member of its squad.
    /// </summary>
    /// <param name="command">The team-sheet read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<TeamSheetResult> HandleAsync(
        GetTeamSheetCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Load the match first, then gate against its squad. A missing match yields the same uniform
        // failure as an unauthorised actor so its (non-)existence is never revealed (Requirement 9.4, 9.5).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return TeamSheetResult.Fail(MatchAuthorization.RequireActiveMember(null).Error!);
        }

        // Any active member of the match's squad may read the team sheet; an inactive membership or a
        // non-member is rejected uniformly, disclosing no content and concealing the match
        // (Requirement 9.4, 9.5).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireActiveMember(acting);
        if (!gate.IsSuccess)
        {
            return TeamSheetResult.Fail(gate.Error!);
        }

        // Project the team sheet from the immutable kickoff lineup captured at team lock
        // (Requirement 9.1, 9.2). Producing the sheet requires the match to be in TeamsRolled.
        return match.ProduceTeamSheet();
    }
}
