namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the absent-actor property (design Property 7). The Current_User_Accessor
/// reports no acting user, so the save must record both actor identifiers as <see langword="null"/>
/// (overriding any caller-supplied values) and still complete. The caller-supplied actor values are
/// deliberately allowed to be non-null so the test also exercises the override-to-null path.
/// </summary>
/// <param name="ClockNow">The UTC instant the Clock reports at save time.</param>
/// <param name="CallerCreatedBy">A caller-supplied creating actor that must be overridden to null.</param>
/// <param name="CallerUpdatedBy">A caller-supplied updating actor that must be overridden to null.</param>
/// <param name="DisplayName">A representative required PII value for the inserted row.</param>
/// <param name="SkillTier">A representative non-PII value for the inserted row.</param>
public sealed record AbsentActorAuditValues(
    DateTimeOffset ClockNow,
    string? CallerCreatedBy,
    string? CallerUpdatedBy,
    string DisplayName,
    int SkillTier);
