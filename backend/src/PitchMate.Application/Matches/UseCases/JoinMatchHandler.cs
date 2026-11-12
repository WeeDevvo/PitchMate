using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Lets a member join a confirmed match as a player themselves. Availability is a guide, so someone
/// who didn't mark the confirmed day, or didn't respond at all, can still play.
/// <para>
/// A match that can't be found, a path squad that isn't the match's own, and an actor who isn't an
/// active registered member of the squad all get the uniform <see cref="MatchErrorCode.Unauthorized"/>
/// failure, so a rejection discloses neither the squad nor the match. The aggregate then owns the rest
/// through <see cref="Match.AddParticipant"/>: the match must be <see cref="MatchState.Confirmed"/>,
/// and a member already playing gets <see cref="MatchErrorCode.AlreadyParticipant"/>. Any failure
/// changes nothing; a success is committed atomically. A player who joins after the teams were rolled
/// is on no team until placed or re-rolled, and the teams can't be locked until they are.
/// </para>
/// </summary>
public sealed class JoinMatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the repositories it loads the match and resolves the acting membership
    /// through, and the unit of work it commits through.
    /// </summary>
    public JoinMatchHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _matches = matches;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>Handles a <see cref="JoinMatchCommand"/>, returning success once the caller is a participant.</summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(JoinMatchCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null || command.SquadId != match.SquadId)
        {
            return Unauthorized();
        }

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);
        Result gate = MatchAuthorization.RequireActiveRegisteredMember(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        Result<MatchParticipant> joined = match.AddParticipant(acting!);
        if (!joined.IsSuccess)
        {
            return Result.Fail(joined.Error!);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result Unauthorized() =>
        Result.Fail(new MatchError(MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
