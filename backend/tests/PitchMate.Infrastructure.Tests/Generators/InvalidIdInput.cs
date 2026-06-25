namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the invalid-identity rejection property (design Property 22). The test
/// constructs an entity (which auto-assigns a v7 id), then forces its tracked <c>Id</c> to the
/// all-zero GUID before saving, and asserts the save is rejected before any I/O and nothing is
/// persisted. The test appends a unique marker to <see cref="DisplayName"/> at runtime so the
/// "not persisted" assertion is robust against the shared container.
/// </summary>
/// <param name="ClockNow">The UTC instant the Clock reports at save time.</param>
/// <param name="DisplayName">A representative required PII value for the would-be row.</param>
/// <param name="SkillTier">A representative non-PII value for the would-be row.</param>
public sealed record InvalidIdInput(
    DateTimeOffset ClockNow,
    string DisplayName,
    int SkillTier);
