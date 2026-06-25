namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the soft-delete transition property (design Property 8). It carries the
/// Clock instant the entity is first persisted at, a (typically later) Clock instant the deletion
/// is performed at — which the save pipeline must record as <c>DeletedAt</c> — plus the actor and a
/// few representative field values so the inserted row is realistic.
/// </summary>
/// <param name="CreateNow">The UTC instant the Clock reports when the entity is first persisted.</param>
/// <param name="DeleteNow">The UTC instant the Clock reports when the deletion is requested; <c>DeletedAt</c> must equal this.</param>
/// <param name="Actor">The current actor stamped onto the audit metadata.</param>
/// <param name="DisplayName">A representative required PII value for the inserted row.</param>
/// <param name="Email">A representative optional PII value for the inserted row.</param>
/// <param name="SkillTier">A representative non-PII value for the inserted row.</param>
public sealed record SoftDeleteTransitionInput(
    DateTimeOffset CreateNow,
    DateTimeOffset DeleteNow,
    string Actor,
    string DisplayName,
    string? Email,
    int SkillTier);
