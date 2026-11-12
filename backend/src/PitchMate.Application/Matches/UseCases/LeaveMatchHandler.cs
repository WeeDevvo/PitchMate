using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Lets a member leave a confirmed match they are playing in. It gates exactly as
/// <see cref="JoinMatchHandler"/> does, then removes the caller through
/// <see cref="Match.RemoveParticipant"/>, which also takes them off any working team. The match must be
/// <see cref="MatchState.Confirmed"/>, and a member who isn't playing gets
/// <see cref="MatchErrorCode.NotAParticipant"/>. Any failure changes nothing; a success is committed
/// atomically.
/// </summary>
public sealed class LeaveMatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the repositories it loads the match and resolves the acting membership
    /// through, and the unit of work it commits through.
    /// </summary>
    public LeaveMatchHandler(
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

    /// <summary>Handles a <see cref="LeaveMatchCommand"/>, returning success once the caller is no longer a participant.</summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(LeaveMatchCommand command, CancellationToken cancellationToken)
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

        Result left = match.RemoveParticipant(acting!.Id);
        if (!left.IsSuccess)
        {
            return left;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result Unauthorized() =>
        Result.Fail(new MatchError(MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
