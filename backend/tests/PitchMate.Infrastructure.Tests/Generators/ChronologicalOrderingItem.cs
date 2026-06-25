namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// A single generated row for the database-evaluated chronological-ordering property
/// (design Property 24). It carries the UTC instant the Clock reports when the row is
/// persisted (so its <c>CreatedAt</c> is stamped to a known value) and whether the row
/// should be soft-deleted after insertion. Several items may share the same
/// <see cref="CreatedAt"/> so the <c>Id</c> tie-breaker is exercised.
/// </summary>
/// <param name="CreatedAt">The UTC instant (microsecond precision) the row's <c>CreatedAt</c> is stamped from.</param>
/// <param name="IsDeleted">Whether the row is soft-deleted after it is persisted.</param>
public sealed record ChronologicalOrderingItem(DateTimeOffset CreatedAt, bool IsDeleted);
