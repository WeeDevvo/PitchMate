namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the duplicate-key dedupe property (design Property 21). A first entity is
/// stored under <see cref="Id"/>; a second entity carrying the same <see cref="Id"/> but a distinct
/// display name is then added and saved, and must be rejected. The distinct names let the test
/// assert the existing stored row is left unchanged (its display name still equals
/// <see cref="FirstDisplayName"/>).
/// </summary>
/// <param name="Id">The shared client-assigned identity both entities carry.</param>
/// <param name="ClockNow">The UTC instant the Clock reports at save time.</param>
/// <param name="FirstDisplayName">The display name of the entity stored first; the existing row must keep this value.</param>
/// <param name="SecondDisplayName">The display name of the rejected duplicate; distinct from <see cref="FirstDisplayName"/>.</param>
/// <param name="SkillTier">A representative non-PII value for the stored row.</param>
public sealed record DuplicateKeyInput(
    Guid Id,
    DateTimeOffset ClockNow,
    string FirstDisplayName,
    string SecondDisplayName,
    int SkillTier);
