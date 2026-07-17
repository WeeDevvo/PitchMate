using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Edits a guest player's display name and/or skill-tier seed (Requirement 3.2, 14). The handler
/// resolves the acting membership from the authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may edit a
/// guest; every other actor is rejected with the uniform authorisation failure that never discloses
/// squad existence and changes nothing (Requirement 14.2). A missing or pending-deletion squad yields
/// the same uniform failure (Requirement 17.3).
/// <para>
/// The target must resolve to a membership of the acting member's squad; an unknown or foreign-squad
/// target is rejected as <see cref="SquadErrorCode.NotAMember"/> with no change. A target that is not
/// a guest membership is rejected as <see cref="SquadErrorCode.ValidationFailed"/> and left unchanged,
/// because this use case edits guests only.
/// </para>
/// <para>
/// When a new display name is supplied the handler renames the guest via
/// <see cref="SquadMembership.Rename"/> under the squad's case-insensitive uniqueness rule — resolving
/// the collision check through <see cref="ISquadMembershipRepository.DisplayNameTakenAsync"/> while
/// excluding the guest itself — rejecting an invalid length as
/// <see cref="SquadErrorCode.ValidationFailed"/> and a collision as
/// <see cref="SquadErrorCode.DisplayNameInUse"/> with no change (Requirement 3.2). When a skill-tier
/// update is requested it applies the seed via <see cref="SquadMembership.UpdateSkillTier"/>, rejecting
/// an undefined value (Requirement 14.6). Any applied change is committed atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>; a request that targets no edit is a no-op success with
/// no commit.
/// </para>
/// </summary>
public sealed class EditGuestHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the squad repository it verifies existence/soft-delete through, the
    /// membership repository it authorises, checks uniqueness, and reads the target through, and the
    /// unit of work it commits with.
    /// </summary>
    public EditGuestHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _squads = squads;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="EditGuestCommand"/>, returning success once the requested edits are
    /// applied, or a typed <see cref="SquadError"/> when authorisation fails, the target is
    /// unknown/foreign/non-guest, a display name is invalid or already in use, or a skill tier is
    /// undefined.
    /// </summary>
    /// <param name="command">The guest-edit request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(EditGuestCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may edit a guest; every other actor is rejected uniformly and
        // nothing changes (Requirement 14.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 14.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return SquadAuthorization.RequireOwnerOrAdmin(null);
        }

        SquadMembership? target =
            await _memberships.GetByIdAsync(command.TargetMembershipId, cancellationToken);

        // The target must resolve to a membership of the acting member's squad (Requirement 8.5).
        if (target is null || target.SquadId != command.SquadId)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.NotAMember,
                "The target is not a member of that squad."));
        }

        // Only a guest membership can be edited as a guest; a registered membership is rejected and
        // left unchanged.
        if (!target.IsGuest)
        {
            return Result.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                "The target is not a guest and cannot be edited as a guest."));
        }

        bool mutated = false;

        // Rename under the case-insensitive uniqueness rule when a new display name is supplied. The
        // collision check excludes the guest itself so re-applying its own name is not a violation
        // (Requirement 3.2).
        if (command.DisplayName is not null)
        {
            string normalised = Normalize(command.DisplayName);
            bool nameTaken = await _memberships.DisplayNameTakenAsync(
                command.SquadId, normalised, target.Id, cancellationToken);

            Result rename = target.Rename(command.DisplayName, _ => nameTaken);
            if (!rename.IsSuccess)
            {
                return rename;
            }

            mutated = true;
        }

        // Apply the skill-tier seed when an update is requested; an undefined value is rejected
        // (Requirement 14.6).
        if (command.UpdateSkillTier)
        {
            Result tier = target.UpdateSkillTier(command.SkillTier);
            if (!tier.IsSuccess)
            {
                return tier;
            }

            mutated = true;
        }

        // Commit only a genuine change; a request that targets no edit is a no-op success.
        if (mutated)
        {
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result.Ok();
    }

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();
}
