namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the anonymisation audit-metadata property (design Property 14). It supplies
/// a first-persist instant/actor and a strictly-later anonymise instant/distinct actor, plus
/// identifying content for the inserted row that is guaranteed to differ from the de-identified
/// placeholders (a non-placeholder <see cref="DisplayName"/> and a non-null <see cref="Email"/>),
/// so that calling <c>Anonymise()</c> genuinely modifies persisted PII and the resulting save is a
/// real update whose <c>UpdatedAt</c>/<c>UpdatedBy</c> can be asserted while
/// <c>CreatedAt</c>/<c>CreatedBy</c> are expected to remain the first-persist values.
/// </summary>
/// <param name="FirstNow">The UTC instant the Clock reports at first persistence.</param>
/// <param name="AnonymiseNow">The UTC instant the Clock reports when the anonymised entity is saved; strictly later than <see cref="FirstNow"/>.</param>
/// <param name="FirstActor">The actor at first persistence.</param>
/// <param name="AnonymiseActor">The actor performing the anonymisation save; distinct from <see cref="FirstActor"/>.</param>
/// <param name="DisplayName">A required PII value guaranteed not to equal the display-name placeholder.</param>
/// <param name="Email">A non-null optional PII value, so anonymisation clears a real value.</param>
/// <param name="AvatarUrl">A non-null optional PII value, so anonymisation clears a real value.</param>
/// <param name="SkillTier">A representative non-PII value, expected to be unchanged by anonymisation.</param>
/// <param name="BibCount">A representative non-PII value, expected to be unchanged by anonymisation.</param>
public sealed record AnonymisationAuditInput(
    DateTimeOffset FirstNow,
    DateTimeOffset AnonymiseNow,
    string FirstActor,
    string AnonymiseActor,
    string DisplayName,
    string Email,
    string AvatarUrl,
    int SkillTier,
    int BibCount);
