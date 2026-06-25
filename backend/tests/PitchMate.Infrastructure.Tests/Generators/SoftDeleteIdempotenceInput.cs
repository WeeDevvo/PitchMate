namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the soft-delete idempotence property (design Property 11). It supplies the
/// creation instant, the instant of the first deletion (which establishes the grace-period start),
/// and a strictly-later instant for a second deletion request. Because the second request targets an
/// already-deleted row, the property asserts that <c>IsDeleted</c> and <c>DeletedAt</c> are left at
/// their first-deletion values (the later instant must <em>not</em> overwrite <c>DeletedAt</c>).
/// </summary>
/// <param name="CreateNow">The UTC instant the Clock reports when the entity is first persisted.</param>
/// <param name="FirstDeleteNow">The UTC instant of the first deletion; the preserved <c>DeletedAt</c> grace-period start.</param>
/// <param name="SecondDeleteNow">The UTC instant of the second deletion request; strictly later than <see cref="FirstDeleteNow"/>.</param>
/// <param name="Actor">The current actor stamped onto the audit metadata.</param>
/// <param name="DisplayName">A representative required PII value for the inserted row.</param>
/// <param name="SkillTier">A representative non-PII value for the inserted row.</param>
public sealed record SoftDeleteIdempotenceInput(
    DateTimeOffset CreateNow,
    DateTimeOffset FirstDeleteNow,
    DateTimeOffset SecondDeleteNow,
    string Actor,
    string DisplayName,
    int SkillTier);
