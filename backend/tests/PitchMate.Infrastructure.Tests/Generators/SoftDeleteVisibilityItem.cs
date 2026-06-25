namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// A single entity specification within a <see cref="SoftDeleteVisibilityInput"/> set (design
/// Property 9): a representative display name and whether this entity should be soft-deleted after
/// the set is persisted. The mix of deleted and non-deleted entities lets the property assert that
/// a default query returns exactly the non-deleted members while an include-deleted query returns
/// all members.
/// </summary>
/// <param name="DisplayName">A representative required PII value for the entity.</param>
/// <param name="Delete">Whether this entity should be soft-deleted after the set is persisted.</param>
public sealed record SoftDeleteVisibilityItem(string DisplayName, bool Delete);
