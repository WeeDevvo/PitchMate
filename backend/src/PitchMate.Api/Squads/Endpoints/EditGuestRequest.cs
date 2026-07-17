using PitchMate.Domain.Rating;

namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of a guest-edit request (Requirements 3.2, 14). The two edits are independent optional
/// intents: a non-null <paramref name="DisplayName"/> renames the guest (trimmed, 1..50, unique);
/// when <paramref name="UpdateSkillTier"/> is <see langword="true"/> the guest's
/// <paramref name="SkillTier"/> seed is set to the supplied value (or cleared when <see langword="null"/>).
/// A request that targets neither edit is a no-op success. The acting user is resolved from the access token.
/// </summary>
/// <param name="DisplayName">The new display name, or <see langword="null"/> to leave it unchanged.</param>
/// <param name="UpdateSkillTier">Whether to apply <paramref name="SkillTier"/> to the guest.</param>
/// <param name="SkillTier">The new skill-tier seed applied when <paramref name="UpdateSkillTier"/> is <see langword="true"/>.</param>
public sealed record EditGuestRequest(
    string? DisplayName = null,
    bool UpdateSkillTier = false,
    SkillTier? SkillTier = null);
