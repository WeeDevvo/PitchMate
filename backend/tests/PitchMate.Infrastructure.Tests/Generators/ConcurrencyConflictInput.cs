namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the concurrency-conflict property (design Property 23). A row is seeded with
/// <see cref="InitialName"/> and loaded into two separate units of work. The first commits a change
/// to <see cref="FirstUpdateName"/> (bumping the <c>xmin</c> token); a subsequent save of the second
/// (stale) copy changing it to <see cref="SecondUpdateName"/> must surface a concurrency conflict.
/// The three names are pairwise distinct so each save is a genuine modification.
/// </summary>
/// <param name="ClockNow">The UTC instant the Clock reports at save time.</param>
/// <param name="InitialName">The seeded display name.</param>
/// <param name="FirstUpdateName">The first (winning) update's display name; distinct from <see cref="InitialName"/>.</param>
/// <param name="SecondUpdateName">The second (stale, losing) update's display name; distinct from <see cref="InitialName"/>.</param>
/// <param name="SkillTier">A representative non-PII value for the stored row.</param>
public sealed record ConcurrencyConflictInput(
    DateTimeOffset ClockNow,
    string InitialName,
    string FirstUpdateName,
    string SecondUpdateName,
    int SkillTier);
