namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the restore round-trip property (design Property 12). It supplies the
/// creation instant, the instant the entity is soft-deleted, and a (typically later) instant the
/// restore is performed at, so the property can persist, delete, then restore an entity and assert
/// that restoration clears <c>IsDeleted</c>, records <c>DeletedAt</c> as absent, and retains the row.
/// </summary>
/// <param name="CreateNow">The UTC instant the Clock reports when the entity is first persisted.</param>
/// <param name="DeleteNow">The UTC instant the Clock reports when the entity is soft-deleted.</param>
/// <param name="RestoreNow">The UTC instant the Clock reports when the entity is restored.</param>
/// <param name="Actor">The current actor stamped onto the audit metadata.</param>
/// <param name="DisplayName">A representative required PII value for the inserted row.</param>
/// <param name="SkillTier">A representative non-PII value for the inserted row.</param>
public sealed record RestoreRoundTripInput(
    DateTimeOffset CreateNow,
    DateTimeOffset DeleteNow,
    DateTimeOffset RestoreNow,
    string Actor,
    string DisplayName,
    int SkillTier);
