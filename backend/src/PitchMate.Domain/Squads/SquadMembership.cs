using PitchMate.Domain.Common;
using PitchMate.Domain.Rating;

namespace PitchMate.Domain.Squads;

/// <summary>
/// Binds a player to one squad and carries that player's squad-scoped state. A membership is backed
/// by <b>exactly one of</b> a registered user (a registered membership, which holds a
/// <see cref="Role"/>) or a guest with no user (a guest membership, which holds no role). This
/// "exactly one backing" invariant is enforced at construction by the factories and mirrored by a
/// database <c>CHECK ((user_id IS NULL) = (role IS NULL))</c> (Requirement 2.1, 2.2, 2.3, 4.1).
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and soft-delete
/// state (Requirement 19.5). Squad-scoped rating and stats state (defined by later specs) hangs off
/// this membership, never off the user (Requirement 2.7). A guest membership holds no contact PII —
/// only a <see cref="DisplayName"/> and an optional <see cref="SkillTier"/> (Requirement 2.8, 14.9).
/// Implementing <see cref="IAnonymisable"/> lets erasure strip PII while retaining the de-identified
/// row so immutable matches and rating replay stay valid (Requirement 18).
/// </para>
/// </summary>
public sealed class SquadMembership : BaseEntity, IAnonymisable
{
    /// <summary>The minimum trimmed length of a membership display name.</summary>
    public const int DisplayNameMinLength = 1;

    /// <summary>The maximum trimmed length of a membership display name.</summary>
    public const int DisplayNameMaxLength = 50;

    /// <summary>The fixed, non-identifying placeholder a display name is replaced with on anonymisation.</summary>
    public const string DisplayNamePlaceholder = "Former player";

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private SquadMembership()
    {
        DisplayName = string.Empty;
    }

    private SquadMembership(
        Guid squadId,
        Guid? userId,
        SquadRole? role,
        string trimmedDisplayName,
        SkillTier? skillTier,
        DateTimeOffset? lawfulBasisAcknowledgedAt)
    {
        SquadId = squadId;
        UserId = userId;
        Role = role;
        State = MembershipState.Active;
        SkillTier = skillTier;
        LawfulBasisAcknowledgedAt = lawfulBasisAcknowledgedAt;
        ClaimCompleted = false;
        DisplayName = string.Empty;
        SetDisplayName(trimmedDisplayName);
    }

    /// <summary>The identity of the squad this membership belongs to.</summary>
    public Guid SquadId { get; private set; }

    /// <summary>
    /// The backing user's identity, or <see langword="null"/> when this is a guest membership
    /// (Requirement 2.2). This nullable value is the backing discriminator: a membership is a guest
    /// membership iff <see cref="UserId"/> is <see langword="null"/>.
    /// </summary>
    public Guid? UserId { get; private set; }

    /// <summary>
    /// The role a registered membership holds within its squad, or <see langword="null"/> for a
    /// guest membership, which holds no role (Requirement 2.1, 4.1). Non-null iff
    /// <see cref="UserId"/> is non-null.
    /// </summary>
    public SquadRole? Role { get; private set; }

    /// <summary>The lifecycle state of the membership (Requirement 2.1).</summary>
    public MembershipState State { get; private set; }

    /// <summary>The trimmed display name shown for this membership within its squad (1..50 characters).</summary>
    public string DisplayName { get; private set; }

    /// <summary>
    /// The trimmed, lower-cased form of <see cref="DisplayName"/> used for case-insensitive
    /// uniqueness, recomputed on every name change. Set to <see langword="null"/> by
    /// <see cref="Anonymise"/> so an anonymised row is exempt from uniqueness and frees its former
    /// name for reuse (Requirement 3.1, 3.4, 18.1).
    /// </summary>
    public string? DisplayNameNormalized { get; private set; }

    /// <summary>
    /// The optional cold-start skill tier recorded at creation as a seeding hint, or
    /// <see langword="null"/> when none was supplied (Requirement 14.5, 14.7).
    /// </summary>
    public SkillTier? SkillTier { get; private set; }

    /// <summary>Whether this membership arrived at its registered backing through a completed guest claim (Requirement 15.1).</summary>
    public bool ClaimCompleted { get; private set; }

    /// <summary>
    /// The instant the lawful-basis acknowledgement was recorded for a guest-origin membership, or
    /// <see langword="null"/> for a membership created directly against a user (Requirement 14.4, 14.10).
    /// </summary>
    public DateTimeOffset? LawfulBasisAcknowledgedAt { get; private set; }

    /// <summary>Whether this is a guest membership: true iff it has no backing user (Requirement 2.2, 2.3).</summary>
    public bool IsGuest => UserId is null;

    /// <summary>
    /// Creates the owner membership for a newly created squad: a registered, <see cref="MembershipState.Active"/>
    /// membership with Role <see cref="SquadRole.Owner"/> backing <paramref name="userId"/>
    /// (Requirement 1.1, 2.1, 4.1). The trimmed display name must be 1..50 characters (Requirement 1.4, 1.6).
    /// </summary>
    /// <param name="squadId">The squad the owner belongs to.</param>
    /// <param name="userId">The backing user; must be non-empty.</param>
    /// <param name="displayName">The requested display name; leading and trailing whitespace is trimmed.</param>
    /// <returns>A success carrying the owner membership, or a validation failure.</returns>
    public static Result<SquadMembership> CreateOwner(Guid squadId, Guid userId, string displayName) =>
        CreateRegistered(squadId, userId, displayName, SquadRole.Owner);

    /// <summary>
    /// Creates a registered <see cref="MembershipState.Active"/> membership with Role
    /// <see cref="SquadRole.Member"/> backing <paramref name="userId"/> (Requirement 2.1, 2.2, 4.1).
    /// The trimmed display name must be 1..50 characters (Requirement 11.8, 14.3).
    /// </summary>
    /// <param name="squadId">The squad the member belongs to.</param>
    /// <param name="userId">The backing user; must be non-empty.</param>
    /// <param name="displayName">The requested display name; leading and trailing whitespace is trimmed.</param>
    /// <returns>A success carrying the member membership, or a validation failure.</returns>
    public static Result<SquadMembership> CreateRegistered(Guid squadId, Guid userId, string displayName) =>
        CreateRegistered(squadId, userId, displayName, SquadRole.Member);

    private static Result<SquadMembership> CreateRegistered(Guid squadId, Guid userId, string displayName, SquadRole role)
    {
        if (userId == Guid.Empty)
        {
            return Result<SquadMembership>.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                "A registered membership requires a non-empty user identifier."));
        }

        var name = ValidateDisplayName(displayName);
        if (!name.IsSuccess)
        {
            return Result<SquadMembership>.Fail(name.Error!);
        }

        // Registered backing: user set AND role non-null (Requirement 2.2, 2.3).
        return Result<SquadMembership>.Ok(
            new SquadMembership(squadId, userId, role, name.Value!, skillTier: null, lawfulBasisAcknowledgedAt: null));
    }

    /// <summary>
    /// Creates a guest <see cref="MembershipState.Active"/> membership: no backing user, no role, an
    /// optional <paramref name="skillTier"/> seed, and the recorded lawful-basis acknowledgement
    /// instant (Requirement 2.2, 2.8, 14.1, 14.5, 14.7). A guest holds no contact PII — only the
    /// display name and optional skill tier (Requirement 2.8, 14.9). The trimmed display name must
    /// be 1..50 characters (Requirement 14.3).
    /// </summary>
    /// <param name="squadId">The squad the guest belongs to.</param>
    /// <param name="displayName">The requested display name; leading and trailing whitespace is trimmed.</param>
    /// <param name="skillTier">An optional cold-start skill tier seed, or <see langword="null"/>.</param>
    /// <param name="lawfulBasisAckAt">The instant the admin's lawful-basis acknowledgement was recorded.</param>
    /// <returns>A success carrying the guest membership, or a validation failure.</returns>
    public static Result<SquadMembership> CreateGuest(
        Guid squadId, string displayName, SkillTier? skillTier, DateTimeOffset lawfulBasisAckAt)
    {
        var name = ValidateDisplayName(displayName);
        if (!name.IsSuccess)
        {
            return Result<SquadMembership>.Fail(name.Error!);
        }

        // Guest backing: user null AND role null (Requirement 2.2, 2.3).
        return Result<SquadMembership>.Ok(
            new SquadMembership(squadId, userId: null, role: null, name.Value!, skillTier, lawfulBasisAckAt));
    }

    /// <summary>
    /// Promotes an active registered member to <see cref="SquadRole.Admin"/> (Requirement 5.1). A
    /// guest (which holds no role), an inactive membership, or a membership whose current role is not
    /// <see cref="SquadRole.Member"/> is rejected and left unchanged (Requirement 5.2, 5.5, 5.7).
    /// </summary>
    public Result PromoteToAdmin()
    {
        if (IsGuest)
        {
            return Fail(SquadErrorCode.ValidationFailed, "A guest membership cannot hold a role.");
        }

        if (State != MembershipState.Active)
        {
            return Fail(SquadErrorCode.ValidationFailed, "Only an active member of the squad can be promoted.");
        }

        if (Role != SquadRole.Member)
        {
            return Fail(SquadErrorCode.ValidationFailed, "Only a Member can be promoted to Admin.");
        }

        Role = SquadRole.Admin;
        return Result.Ok();
    }

    /// <summary>
    /// Demotes an active <see cref="SquadRole.Admin"/> back to <see cref="SquadRole.Member"/>
    /// (Requirement 5.3). A guest, the owner (which cannot be demoted), an inactive membership, or a
    /// membership whose current role is not <see cref="SquadRole.Admin"/> is rejected and left
    /// unchanged (Requirement 5.4, 5.5, 5.6, 5.7).
    /// </summary>
    public Result DemoteToMember()
    {
        if (IsGuest)
        {
            return Fail(SquadErrorCode.ValidationFailed, "A guest membership cannot hold a role.");
        }

        if (Role == SquadRole.Owner)
        {
            return Fail(SquadErrorCode.OwnerConstraint, "The Owner role cannot be removed by demotion.");
        }

        if (State != MembershipState.Active)
        {
            return Fail(SquadErrorCode.ValidationFailed, "Only an active member of the squad can be demoted.");
        }

        if (Role != SquadRole.Admin)
        {
            return Fail(SquadErrorCode.ValidationFailed, "Only an Admin can be demoted to Member.");
        }

        Role = SquadRole.Member;
        return Result.Ok();
    }

    /// <summary>
    /// Promotes an active registered membership to <see cref="SquadRole.Owner"/>. Used as the
    /// promote half of an atomic ownership transfer (Requirement 6.2). A guest or inactive membership
    /// is rejected and left unchanged.
    /// </summary>
    public Result AssignOwner()
    {
        if (IsGuest)
        {
            return Fail(SquadErrorCode.ValidationFailed, "A guest membership cannot be made owner.");
        }

        if (State != MembershipState.Active)
        {
            return Fail(SquadErrorCode.ValidationFailed, "Only an active member of the squad can be made owner.");
        }

        Role = SquadRole.Owner;
        return Result.Ok();
    }

    /// <summary>
    /// Steps the current owner down to <see cref="SquadRole.Admin"/>. Used as the demote half of an
    /// atomic ownership transfer (Requirement 6.2). A membership whose role is not
    /// <see cref="SquadRole.Owner"/> is rejected and left unchanged.
    /// </summary>
    public Result StepDownToAdmin()
    {
        if (Role != SquadRole.Owner)
        {
            return Fail(SquadErrorCode.ValidationFailed, "Only the current owner can step down to Admin.");
        }

        Role = SquadRole.Admin;
        return Result.Ok();
    }

    /// <summary>
    /// Leaves the squad by setting <see cref="MembershipState.Inactive"/> while retaining rating,
    /// stats, and history (Requirement 7.1). An owner is rejected and must transfer ownership first
    /// (Requirement 7.2). A membership that is already inactive is treated as satisfied and reports
    /// success (Requirement 7.3).
    /// </summary>
    public Result Leave()
    {
        if (State == MembershipState.Inactive)
        {
            return Result.Ok();
        }

        if (Role == SquadRole.Owner)
        {
            return Fail(SquadErrorCode.OwnerConstraint, "Ownership must be transferred before leaving the squad.");
        }

        State = MembershipState.Inactive;
        return Result.Ok();
    }

    /// <summary>
    /// Deactivates the membership by setting <see cref="MembershipState.Inactive"/>, retaining its
    /// history; used by the admin removal path (Requirement 8.1). Idempotent: already-inactive rows
    /// are left inactive (Requirement 8.4).
    /// </summary>
    public void Deactivate() => State = MembershipState.Inactive;

    /// <summary>
    /// Reactivates an inactive membership, setting <see cref="MembershipState.Active"/> while
    /// preserving rating, stats, and history unchanged (Requirement 9.1, 9.3). An
    /// <see cref="SquadRole.Admin"/> is downgraded to <see cref="SquadRole.Member"/> while an
    /// <see cref="SquadRole.Owner"/> is retained (Requirement 9.4). Reactivation completes with the
    /// existing display name only when it is still unique; otherwise a unique
    /// <paramref name="newDisplayName"/> of 1..50 characters must be supplied, and until then the
    /// membership is left inactive (Requirement 9.5).
    /// </summary>
    /// <param name="newDisplayName">An optional replacement display name to resolve a collision, or <see langword="null"/> to keep the current one.</param>
    /// <param name="isNameTaken">Predicate returning whether a normalised name is already held by another non-anonymised membership in the squad.</param>
    public Result Reactivate(string? newDisplayName, Func<string, bool> isNameTaken)
    {
        ArgumentNullException.ThrowIfNull(isNameTaken);

        string? nameToApply = null;

        if (newDisplayName is not null)
        {
            var validated = ValidateDisplayName(newDisplayName);
            if (!validated.IsSuccess)
            {
                return Result.Fail(validated.Error!);
            }

            var normalized = Normalize(validated.Value!);
            if (isNameTaken(normalized))
            {
                return Fail(SquadErrorCode.DisplayNameInUse, "The requested display name is already in use in this squad.");
            }

            nameToApply = validated.Value!;
        }
        else
        {
            // No replacement supplied: the current name must still be usable and unique.
            if (DisplayNameNormalized is null || isNameTaken(DisplayNameNormalized))
            {
                return Fail(
                    SquadErrorCode.DisplayNameInUse,
                    "The current display name now collides; supply a unique display name to reactivate.");
            }
        }

        if (nameToApply is not null)
        {
            SetDisplayName(nameToApply);
        }

        State = MembershipState.Active;
        if (Role == SquadRole.Admin)
        {
            Role = SquadRole.Member;
        }

        return Result.Ok();
    }

    /// <summary>
    /// Renames the membership to <paramref name="displayName"/>, recomputing the normalised key.
    /// The trimmed name must be 1..50 characters (Requirement 3.5) and must not collide, after
    /// trimming and case-insensitive comparison, with another non-anonymised membership in the squad
    /// (Requirement 3.1, 3.2). A violation leaves the current name unchanged.
    /// </summary>
    /// <param name="displayName">The requested new display name; leading and trailing whitespace is trimmed.</param>
    /// <param name="isNameTaken">Predicate returning whether a normalised name is already held by another non-anonymised membership in the squad.</param>
    public Result Rename(string displayName, Func<string, bool> isNameTaken)
    {
        ArgumentNullException.ThrowIfNull(isNameTaken);

        var validated = ValidateDisplayName(displayName);
        if (!validated.IsSuccess)
        {
            return Result.Fail(validated.Error!);
        }

        var normalized = Normalize(validated.Value!);
        if (isNameTaken(normalized))
        {
            return Fail(SquadErrorCode.DisplayNameInUse, "The requested display name is already in use in this squad.");
        }

        SetDisplayName(validated.Value!);
        return Result.Ok();
    }

    /// <summary>
    /// Completes a guest claim by rebinding a guest membership to <paramref name="userId"/> as a
    /// registered <see cref="SquadRole.Member"/> and setting <see cref="ClaimCompleted"/>, leaving
    /// <see cref="State"/> and <see cref="DisplayName"/> unchanged so rating, stats, and history are
    /// preserved (Requirement 15.1, 15.2).
    /// </summary>
    /// <param name="userId">The claimed user's identity.</param>
    public void CompleteClaim(Guid userId)
    {
        UserId = userId;
        Role = SquadRole.Member;
        ClaimCompleted = true;
    }

    /// <summary>
    /// Reverses a previously completed guest claim by rebinding the membership from its user back to
    /// a guest and clearing <see cref="ClaimCompleted"/>, preserving rating, stats, and history
    /// (Requirement 15.6). Rejected when no completed claim exists (Requirement 15.8).
    /// </summary>
    public Result ReverseClaim()
    {
        if (!ClaimCompleted)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "There is no completed claim to reverse.");
        }

        UserId = null;
        Role = null;
        ClaimCompleted = false;
        return Result.Ok();
    }

    /// <summary>
    /// Strips personally identifying information on erasure: replaces <see cref="DisplayName"/> with
    /// <see cref="DisplayNamePlaceholder"/>, clears <see cref="DisplayNameNormalized"/> (exempting the
    /// row from uniqueness and freeing the former name), and clears the backing
    /// <see cref="UserId"/> and <see cref="Role"/>, while retaining the row, its
    /// <see cref="BaseEntity.Id"/>, its <see cref="SquadId"/>, and its rating/match links so
    /// chronological rating replay still holds (Requirement 3.4, 18.1, 18.7). Idempotent.
    /// </summary>
    public void Anonymise()
    {
        DisplayName = DisplayNamePlaceholder;
        DisplayNameNormalized = null;
        UserId = null;
        Role = null;
    }

    private void SetDisplayName(string displayName)
    {
        var trimmed = displayName.Trim();
        DisplayName = trimmed;
        DisplayNameNormalized = Normalize(trimmed);
    }

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();

    private static Result<string> ValidateDisplayName(string displayName)
    {
        var trimmed = displayName?.Trim() ?? string.Empty;
        if (trimmed.Length < DisplayNameMinLength || trimmed.Length > DisplayNameMaxLength)
        {
            return Result<string>.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                $"Display name must be {DisplayNameMinLength} to {DisplayNameMaxLength} characters after trimming."));
        }

        return Result<string>.Ok(trimmed);
    }

    private static Result Fail(SquadErrorCode code, string message) =>
        Result.Fail(new SquadError(code, message));
}
