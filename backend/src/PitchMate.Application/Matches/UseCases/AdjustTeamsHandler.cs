using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
// Both PitchMate.Domain.Matches and PitchMate.Domain.Rating define a Result<T>; import only the
// specific rating type this handler needs so the unqualified Result<T> binds to the Matches triad.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Applies a single adjustment to a match's working teams while rolling them (Requirement 8.3). The
/// handler loads the squad-scoped match, resolves the acting user's membership in that match's squad,
/// and gates through <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered
/// owner or admin may adjust teams; a match that cannot be found and any non-organiser both yield the
/// single uniform <see cref="MatchErrorCode.Unauthorized"/> failure, disclosing neither the squad nor
/// the match (Requirement 14.1, 14.2, 14.3).
/// <para>
/// Each <see cref="TeamAdjustment"/> case is mapped onto the <see cref="Match"/> aggregate, which owns
/// the state gate (working teams are editable only while <see cref="MatchState.Confirmed"/> or
/// <see cref="MatchState.TeamsRolled"/>) and the partition invariant (Requirement 8.2, 8.3):
/// <list type="bullet">
///   <item><see cref="TeamAdjustment.MoveParticipant"/> → <see cref="Match.MoveParticipant"/>;</item>
///   <item><see cref="TeamAdjustment.SetTeamName"/> → <see cref="Match.SetTeamName"/>, drawing a name
///   from <see cref="ISillyNameGenerator"/> only when the admin supplies none (Requirement 8.4);</item>
///   <item><see cref="TeamAdjustment.SetBibTeam"/> → <see cref="Match.SetBibTeam"/>;</item>
///   <item><see cref="TeamAdjustment.ReRoll"/> → a fresh <see cref="ITeamBalancer"/> assignment applied
///   via <see cref="Match.ApplyTeamProposal"/>, preserving existing team names and bib flags by
///   position and generating silly names on a first roll (Requirement 8.3).</item>
/// </list>
/// A failed aggregate operation is returned as-is with nothing committed; on success the change is
/// committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>. Adjusting teams never
/// changes the match's lifecycle state and alters no rating.
/// </para>
/// </summary>
public sealed class AdjustTeamsHandler
{
    private const int TeamCount = 2;

    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMembershipRatingRepository _ratings;
    private readonly IRatingEngine _ratingEngine;
    private readonly ITeamBalancer _balancer;
    private readonly ISillyNameGenerator _sillyNames;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the acting membership through (and reads skill tiers
    /// from for a re-roll), the membership-rating repository and rating engine it sources ratings from
    /// for a re-roll, the team balancer it requests a re-roll assignment from, the silly-name generator
    /// it draws a team name from when the admin supplies none, and the unit of work it commits through.
    /// </summary>
    public AdjustTeamsHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IMembershipRatingRepository ratings,
        IRatingEngine ratingEngine,
        ITeamBalancer balancer,
        ISillyNameGenerator sillyNames,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(ratings);
        ArgumentNullException.ThrowIfNull(ratingEngine);
        ArgumentNullException.ThrowIfNull(balancer);
        ArgumentNullException.ThrowIfNull(sillyNames);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _matches = matches;
        _memberships = memberships;
        _ratings = ratings;
        _ratingEngine = ratingEngine;
        _balancer = balancer;
        _sillyNames = sillyNames;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="AdjustTeamsCommand"/>, returning success once the adjustment is applied
    /// and committed, or a typed <see cref="MatchError"/> — a uniform authorisation failure for an
    /// unfindable match or a non-organiser, or the aggregate's state/validation failure when the edit
    /// cannot be applied.
    /// </summary>
    /// <param name="command">The adjustment request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(AdjustTeamsCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(command.Adjustment);

        // Load the squad-scoped match. A match that cannot be found is rejected with the same uniform
        // authorisation failure so a rejection never discloses whether the match exists
        // (Requirement 14.1, 14.3).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Resolve the acting membership and gate: only an active registered owner or admin may adjust
        // teams (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // Map the adjustment onto the aggregate; the aggregate owns the state gate and partition rules.
        Result applied = command.Adjustment switch
        {
            TeamAdjustment.MoveParticipant move =>
                match.MoveParticipant(move.SquadMembershipId, move.ToTeamId),
            TeamAdjustment.SetTeamName rename =>
                match.SetTeamName(rename.TeamId, ResolveTeamName(rename.TeamName)),
            TeamAdjustment.SetBibTeam bib =>
                match.SetBibTeam(bib.TeamId),
            TeamAdjustment.ReRoll =>
                await ReRollAsync(match, cancellationToken),
            _ => Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed, "The requested team adjustment is not supported.")),
        };

        if (!applied.IsSuccess)
        {
            return applied;
        }

        // Persist the adjustment atomically (Requirement 8.3).
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    /// <summary>
    /// Resolves the name to apply for a rename: the admin's supplied name when it is non-blank, or a
    /// freshly generated silly name when the admin supplies none (Requirement 8.4). The name is passed
    /// to the aggregate as-is; its trimmed length and uniqueness are validated at lock.
    /// </summary>
    private string ResolveTeamName(string? supplied) =>
        string.IsNullOrWhiteSpace(supplied) ? _sillyNames.Next() : supplied;

    /// <summary>
    /// Re-rolls the working teams: enforces the proposal preconditions (state and participant count,
    /// Requirement 8.9), requests a fresh balanced assignment, and applies it via
    /// <see cref="Match.ApplyTeamProposal"/>. Existing team names and bib flags are preserved by
    /// position when the match already carries the same number of working teams; on a first roll each
    /// team is given a generated silly name and the first team is flagged to wear bibs
    /// (Requirement 8.3, 8.4).
    /// </summary>
    private async Task<Result> ReRollAsync(Match match, CancellationToken cancellationToken)
    {
        if (match.State is not (MatchState.Confirmed or MatchState.TeamsRolled))
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Teams can only be rolled while the match is Confirmed or TeamsRolled; the match is {match.State}."));
        }

        int participantCount = match.Participants.Count;
        if (participantCount is < ProposeTeamsHandler.MinParticipants or > ProposeTeamsHandler.MaxParticipants)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Rolling teams requires {ProposeTeamsHandler.MinParticipants} to {ProposeTeamsHandler.MaxParticipants} "
                + $"participants; the match has {participantCount}."));
        }

        Result<TeamBalanceRequest> request = await TeamBalanceRequestFactory.BuildAsync(
            match, TeamCount, _ratings, _memberships, _ratingEngine, cancellationToken);
        if (!request.IsSuccess)
        {
            return Result.Fail(request.Error!);
        }

        Result<TeamProposal> proposal = await _balancer.ProposeAsync(request.Value!, cancellationToken);
        if (!proposal.IsSuccess)
        {
            return Result.Fail(proposal.Error!);
        }

        IReadOnlyList<ProposedTeam> teams = BuildProposedTeams(match, proposal.Value!);
        return match.ApplyTeamProposal(teams);
    }

    /// <summary>
    /// Materialises the balancer's assignment into <see cref="ProposedTeam"/> values, carrying the team
    /// names and bib flags forward: when the match already has the same number of working teams their
    /// names and bib flags are reused by position, otherwise each team is given a generated silly name
    /// and the first team is flagged to wear bibs (Requirement 8.3, 8.4).
    /// </summary>
    private IReadOnlyList<ProposedTeam> BuildProposedTeams(Match match, TeamProposal proposal)
    {
        List<MatchTeam> existing = match.Teams.ToList();
        bool reuse = existing.Count == proposal.Teams.Count;

        var teams = new List<ProposedTeam>(proposal.Teams.Count);
        for (int i = 0; i < proposal.Teams.Count; i++)
        {
            ProposedTeamAssignment assignment = proposal.Teams[i];

            string name = reuse ? existing[i].TeamName : _sillyNames.Next();
            bool bib = reuse ? existing[i].BibFlag : i == 0;

            teams.Add(new ProposedTeam(name, bib, assignment.ParticipantMembershipIds));
        }

        return teams;
    }

    private static Result Unauthorized() =>
        Result.Fail(new MatchError(MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
