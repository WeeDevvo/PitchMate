namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the anonymisation soft-delete-preservation property (design Property 15).
/// Each iteration exercises <em>both</em> soft-delete states by persisting two entities — one left
/// live and one soft-deleted before anonymisation — then anonymising and saving each. The instants
/// are ordered create → delete → anonymise so the soft-deleted row's <c>DeletedAt</c> is a known
/// value that anonymisation must leave untouched, and both rows carry non-placeholder identifying
/// content so the anonymise save is a genuine modification.
/// </summary>
/// <param name="CreateNow">The UTC instant the Clock reports when both entities are first persisted.</param>
/// <param name="DeleteNow">The UTC instant the Clock reports when the to-be-deleted entity is soft-deleted.</param>
/// <param name="AnonymiseNow">The UTC instant the Clock reports when each entity is anonymised and saved; strictly later than <see cref="DeleteNow"/>.</param>
/// <param name="Actor">The current actor stamped onto the audit metadata throughout.</param>
/// <param name="LiveDisplayName">A required non-placeholder PII value for the entity that stays live.</param>
/// <param name="LiveEmail">A non-null optional PII value for the entity that stays live.</param>
/// <param name="DeletedDisplayName">A required non-placeholder PII value for the entity that is soft-deleted.</param>
/// <param name="DeletedEmail">A non-null optional PII value for the entity that is soft-deleted.</param>
/// <param name="SkillTier">A representative non-PII value for both inserted rows.</param>
public sealed record AnonymisationSoftDeleteInput(
    DateTimeOffset CreateNow,
    DateTimeOffset DeleteNow,
    DateTimeOffset AnonymiseNow,
    string Actor,
    string LiveDisplayName,
    string LiveEmail,
    string DeletedDisplayName,
    string DeletedEmail,
    int SkillTier);
