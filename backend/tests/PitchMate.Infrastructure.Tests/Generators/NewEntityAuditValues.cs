namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the first-persist audit-stamping property (design Property 5). It carries
/// the Clock instant and actor the save pipeline must stamp from, plus deliberately arbitrary
/// caller-supplied audit values (<see cref="CallerCreatedAt"/>, <see cref="CallerUpdatedAt"/>,
/// <see cref="CallerCreatedBy"/>, <see cref="CallerUpdatedBy"/>) that the save must override, and a
/// few entity field values so the inserted row is representative.
/// </summary>
/// <param name="ClockNow">The UTC instant the Clock reports at save time; both timestamps must equal this.</param>
/// <param name="Actor">The current actor; both actor identifiers must equal this after the first save.</param>
/// <param name="CallerCreatedAt">A caller-supplied creation timestamp the save must override.</param>
/// <param name="CallerUpdatedAt">A caller-supplied update timestamp the save must override.</param>
/// <param name="CallerCreatedBy">A caller-supplied creating actor the save must override.</param>
/// <param name="CallerUpdatedBy">A caller-supplied updating actor the save must override.</param>
/// <param name="DisplayName">A representative required PII value for the inserted row.</param>
/// <param name="Email">A representative optional PII value for the inserted row.</param>
/// <param name="SkillTier">A representative non-PII value for the inserted row.</param>
public sealed record NewEntityAuditValues(
    DateTimeOffset ClockNow,
    string Actor,
    DateTimeOffset CallerCreatedAt,
    DateTimeOffset CallerUpdatedAt,
    string? CallerCreatedBy,
    string? CallerUpdatedBy,
    string DisplayName,
    string? Email,
    int SkillTier);
