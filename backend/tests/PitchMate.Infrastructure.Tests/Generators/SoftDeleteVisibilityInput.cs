namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the soft-delete query-visibility property (design Property 9). It supplies a
/// non-empty set of entity specifications (each marked for deletion or not) plus the Clock instants
/// used when the set is created and when the flagged members are deleted, so the property can assert
/// that a default query returns only the non-deleted members and an include-deleted query returns
/// every member regardless of its deletion state.
/// </summary>
/// <param name="CreateNow">The UTC instant the Clock reports when the set is first persisted.</param>
/// <param name="DeleteNow">The UTC instant the Clock reports when the flagged members are deleted.</param>
/// <param name="Items">The non-empty set of entity specifications to persist and selectively delete.</param>
public sealed record SoftDeleteVisibilityInput(
    DateTimeOffset CreateNow,
    DateTimeOffset DeleteNow,
    IReadOnlyList<SoftDeleteVisibilityItem> Items);
