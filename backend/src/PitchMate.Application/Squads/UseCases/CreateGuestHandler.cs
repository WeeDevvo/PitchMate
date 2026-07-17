using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Creates a guest player in a squad (Requirement 14). The handler resolves the acting membership
/// from the authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may create a
/// guest; every other actor — a plain member, an inactive membership, a guest, or a non-member — is
/// rejected with the uniform authorisation failure that never discloses squad existence and creates no
/// guest (Requirement 14.2). A missing or pending-deletion squad yields the same uniform failure
/// (Requirement 17.3).
/// <para>
/// A guest is created only when a lawful-basis acknowledgement is recorded; a request without one is
/// rejected as <see cref="SquadErrorCode.ValidationFailed"/> and creates no guest (Requirement 14.4).
/// A supplied <see cref="SkillTier"/> that is not a defined value is likewise rejected
/// (Requirement 14.6), while an omitted tier records no seed (Requirement 14.7). The domain
/// <see cref="SquadMembership.CreateGuest"/> factory trims and validates the display name to 1..50
/// characters, records the optional tier, and stamps the acknowledgement instant read from the clock
/// (Requirement 14.3, 14.5, 14.10). Before committing, the handler enforces display-name uniqueness
/// within the squad via <see cref="ISquadMembershipRepository.DisplayNameTakenAsync"/>, rejecting a
/// collision with <see cref="SquadErrorCode.DisplayNameInUse"/> and creating no guest
/// (Requirement 3.2, 14.8). On success it stages exactly one active guest membership — no user
/// reference and no role — and commits it atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, the creating admin and creation instant captured as
/// audit by the persistence pipeline (Requirement 14.1, 14.9, 14.10).
/// </para>
/// </summary>
public sealed class CreateGuestHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the squad repository it verifies existence/soft-delete through, the
    /// membership repository it authorises, checks uniqueness, and stages the insert into, the unit of
    /// work it commits with, and the clock it stamps the lawful-basis acknowledgement instant from.
    /// </summary>
    public CreateGuestHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="CreateGuestCommand"/>, returning the created guest membership's identity on
    /// success, or a typed <see cref="SquadError"/> when authorisation, the lawful-basis rule, the
    /// skill-tier or display-name validation, or uniqueness rejects the request.
    /// </summary>
    /// <param name="command">The guest-creation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<CreateGuestResult>> HandleAsync(
        CreateGuestCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may create a guest; every other actor is rejected uniformly
        // and no guest is created (Requirement 14.2).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return Result<CreateGuestResult>.Fail(gate.Error!);
        }

        // Load the squad, excluding soft-deleted ones. A missing or pending-deletion squad yields the
        // same uniform failure so its (non-)existence is never revealed (Requirement 14.2, 17.3).
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<CreateGuestResult>.Fail(SquadAuthorization.RequireOwnerOrAdmin(null).Error!);
        }

        // A guest is created only when the admin has recorded a lawful-basis acknowledgement
        // (Requirement 14.4).
        if (!command.LawfulBasisAcknowledged)
        {
            return Fail(
                SquadErrorCode.ValidationFailed,
                "A lawful-basis acknowledgement is required to create a guest.");
        }

        // A supplied skill tier must be a defined value; an omitted one records no seed
        // (Requirement 14.6, 14.7).
        if (command.SkillTier is not null && !Enum.IsDefined(command.SkillTier.Value))
        {
            return Fail(SquadErrorCode.ValidationFailed, "The requested skill tier is not a defined value.");
        }

        // Build the active guest membership: no user, no role, optional tier seed, and the
        // acknowledgement instant read from the clock; the factory trims and validates the display
        // name to 1..50 characters (Requirement 14.1, 14.3, 14.5, 14.10).
        Result<SquadMembership> created = SquadMembership.CreateGuest(
            command.SquadId,
            command.DisplayName ?? string.Empty,
            command.SkillTier,
            _clock.GetUtcNow());
        if (!created.IsSuccess)
        {
            return Result<CreateGuestResult>.Fail(created.Error!);
        }

        SquadMembership guest = created.Value!;

        // Enforce display-name uniqueness within the squad before committing; a collision creates no
        // guest (Requirement 3.2, 14.8).
        bool nameTaken = await _memberships.DisplayNameTakenAsync(
            command.SquadId, guest.DisplayNameNormalized!, excludingMembershipId: null, cancellationToken);
        if (nameTaken)
        {
            return Fail(SquadErrorCode.DisplayNameInUse, "The requested display name is already in use in this squad.");
        }

        await _memberships.AddAsync(guest, cancellationToken);

        // Persist the single guest membership atomically; a failure persists no guest (Requirement 14.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<CreateGuestResult>.Ok(new CreateGuestResult(guest.Id));
    }

    private static Result<CreateGuestResult> Fail(SquadErrorCode code, string message) =>
        Result<CreateGuestResult>.Fail(new SquadError(code, message));
}
