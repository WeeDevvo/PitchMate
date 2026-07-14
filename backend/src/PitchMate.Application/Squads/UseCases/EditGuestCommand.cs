using PitchMate.Domain.Rating;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to edit a guest player's display name and/or skill-tier seed in
/// their squad (Requirement 3.2, 14). The acting user must hold an active <c>Owner</c> or <c>Admin</c>
/// membership in the target squad, and the target must be a guest membership of the same squad.
/// <para>
/// The two edits are independent optional intents. When <paramref name="DisplayName"/> is non-null the
/// guest is renamed, trimmed and validated to 1..50 characters and required to remain unique within
/// the squad (Requirement 3.2); when it is <see langword="null"/> the display name is left unchanged.
/// When <paramref name="UpdateSkillTier"/> is <see langword="true"/> the guest's
/// <paramref name="SkillTier"/> seed is set to the supplied value (or cleared when that value is
/// <see langword="null"/>) and must be a defined <see cref="Rating.SkillTier"/> (Requirement 14.6);
/// when it is <see langword="false"/> the skill tier is left unchanged. A request that targets neither
/// edit is a no-op success.
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated owner or admin performing the edit.</param>
/// <param name="SquadId">The squad the guest belongs to.</param>
/// <param name="TargetMembershipId">The guest membership to edit.</param>
/// <param name="DisplayName">The new display name, or <see langword="null"/> to leave it unchanged.</param>
/// <param name="UpdateSkillTier">Whether to apply <paramref name="SkillTier"/> to the guest.</param>
/// <param name="SkillTier">
/// The new skill-tier seed applied when <paramref name="UpdateSkillTier"/> is <see langword="true"/>;
/// <see langword="null"/> clears the seed.
/// </param>
public sealed record EditGuestCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid TargetMembershipId,
    string? DisplayName = null,
    bool UpdateSkillTier = false,
    SkillTier? SkillTier = null);
