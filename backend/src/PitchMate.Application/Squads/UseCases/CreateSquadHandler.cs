using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Creates a squad and its owner membership for an authenticated user (Requirement 1). The handler
/// validates the squad name (trimmed 1..80 characters) and resolves the owner display name — using
/// the supplied value when one is given, otherwise deriving it from the creating user's identity
/// display name — then validates that resolved name to a trimmed length of 1..50 characters
/// (Requirement 1.2, 1.4, 1.5, 1.6). As a single atomic unit of work it stages the
/// <see cref="Squad"/> (with every <see cref="SquadFeature"/> initialised disabled) plus the
/// <see cref="SquadRole.Owner"/> <see cref="SquadMembership"/> and commits them through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, so that if any step fails no squad and no membership
/// are persisted (Requirement 1.1, 1.3).
/// </summary>
public sealed class CreateSquadHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUserRepository _users;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the squad and membership repositories it stages inserts into, the
    /// user repository it derives a default owner display name from, and the unit of work it commits
    /// through.
    /// </summary>
    public CreateSquadHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IUserRepository users,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _squads = squads;
        _memberships = memberships;
        _users = users;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="CreateSquadCommand"/>, returning the created squad and owner membership
    /// identities on success or a typed <see cref="SquadError"/> on validation failure.
    /// </summary>
    /// <param name="command">The squad-creation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<CreateSquadResult>> HandleAsync(
        CreateSquadCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (command.CreatingUserId == Guid.Empty)
        {
            return Fail(SquadErrorCode.ValidationFailed, "A creating user identifier is required.");
        }

        // Resolve the owner display name: use the supplied value when one is given, otherwise derive
        // it from the creating user's identity display name (Requirement 1.4, 1.5).
        Result<string> displayName = await ResolveOwnerDisplayNameAsync(command, cancellationToken);
        if (!displayName.IsSuccess)
        {
            return Result<CreateSquadResult>.Fail(displayName.Error!);
        }

        // Validate + build the squad (trimmed 1..80 name, every feature disabled) (Requirement 1.1, 1.2, 1.3).
        Result<Squad> squadResult = Squad.Create(command.Name ?? string.Empty);
        if (!squadResult.IsSuccess)
        {
            return Result<CreateSquadResult>.Fail(squadResult.Error!);
        }

        Squad squad = squadResult.Value!;

        // Validate + build the owner membership (trimmed 1..50 display name) (Requirement 1.4, 1.6).
        Result<SquadMembership> ownerResult =
            SquadMembership.CreateOwner(squad.Id, command.CreatingUserId, displayName.Value!);
        if (!ownerResult.IsSuccess)
        {
            return Result<CreateSquadResult>.Fail(ownerResult.Error!);
        }

        SquadMembership owner = ownerResult.Value!;

        await _squads.AddAsync(squad, cancellationToken);
        await _memberships.AddAsync(owner, cancellationToken);

        // Persist the squad + owner membership atomically; a failure rolls back both (Requirement 1.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<CreateSquadResult>.Ok(new CreateSquadResult(squad.Id, owner.Id));
    }

    private async Task<Result<string>> ResolveOwnerDisplayNameAsync(
        CreateSquadCommand command,
        CancellationToken cancellationToken)
    {
        // A supplied display name (non-null) is used as-is; the membership factory trims it and
        // rejects a trimmed length outside 1..50 (Requirement 1.4, 1.6).
        if (command.DisplayName is not null)
        {
            return Result<string>.Ok(command.DisplayName);
        }

        // No display name supplied: derive the default from the creating user's identity display
        // name; the membership factory validates its trimmed length (Requirement 1.5, 1.6).
        Domain.Auth.User? user = await _users.GetByIdAsync(command.CreatingUserId, cancellationToken);
        if (user is null)
        {
            return Result<string>.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                "The creating user could not be found to derive an owner display name."));
        }

        return Result<string>.Ok(user.DisplayName);
    }

    private static Result<CreateSquadResult> Fail(SquadErrorCode code, string message) =>
        Result<CreateSquadResult>.Fail(new SquadError(code, message));
}
