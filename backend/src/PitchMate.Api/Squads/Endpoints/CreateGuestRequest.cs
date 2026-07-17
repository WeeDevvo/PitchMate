using PitchMate.Domain.Rating;

namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of a guest-creation request (Requirement 14). The <paramref name="DisplayName"/> is
/// trimmed and validated (1..50 characters) and must be unique within the squad. A guest is created
/// only when <paramref name="LawfulBasisAcknowledged"/> is <see langword="true"/>, whose instant the
/// handler stamps from the clock. An optional <paramref name="SkillTier"/> cold-start seed is recorded
/// when supplied. The acting user is resolved from the access token.
/// </summary>
/// <param name="DisplayName">The guest's requested display name.</param>
/// <param name="SkillTier">An optional cold-start skill-tier seed, or <see langword="null"/> for none.</param>
/// <param name="LawfulBasisAcknowledged">Whether the admin has recorded the one-time lawful-basis acknowledgement.</param>
public sealed record CreateGuestRequest(
    string? DisplayName,
    SkillTier? SkillTier = null,
    bool LawfulBasisAcknowledged = false);
