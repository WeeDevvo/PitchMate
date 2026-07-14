using PitchMate.Domain.Rating;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to create a guest player in their squad (Requirement 14). The
/// acting user must hold an active <c>Owner</c> or <c>Admin</c> membership in the target squad
/// (Requirement 14.2). The <paramref name="DisplayName"/> is trimmed and validated to 1..50
/// characters and must be unique within the squad (Requirement 14.1, 14.3, 14.8); it may be
/// <see langword="null"/> so malformed input is reported as a validation failure rather than throwing.
/// <para>
/// A guest is created only when a <paramref name="LawfulBasisAcknowledged"/> acknowledgement is
/// recorded, whose instant the handler stamps from the clock (Requirement 14.4, 14.10). An optional
/// <paramref name="SkillTier"/> cold-start seed is recorded when supplied and must be a defined
/// <see cref="Rating.SkillTier"/> value; when omitted the guest is created with no seed
/// (Requirement 14.5, 14.6, 14.7).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated owner or admin creating the guest.</param>
/// <param name="SquadId">The squad the guest is created in.</param>
/// <param name="DisplayName">The guest's requested display name; trimmed and validated by the handler.</param>
/// <param name="SkillTier">An optional cold-start skill-tier seed, or <see langword="null"/> for none.</param>
/// <param name="LawfulBasisAcknowledged">
/// Whether the admin has recorded the one-time lawful-basis acknowledgement required to hold the
/// guest's data; creation is rejected when this is <see langword="false"/>.
/// </param>
public sealed record CreateGuestCommand(
    Guid ActingUserId,
    Guid SquadId,
    string? DisplayName,
    SkillTier? SkillTier = null,
    bool LawfulBasisAcknowledged = false);
