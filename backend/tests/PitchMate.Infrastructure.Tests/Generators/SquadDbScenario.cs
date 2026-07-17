namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the squad DB-invariant property tests (task 18.5, design Properties 1, 13,
/// 14, 30, 34, 36, 38). It carries a valid squad name plus three pairwise-distinct, valid display
/// names — an owner and two further members/guests — and a valid grace period, so each property can
/// build a realistic squad against real PostgreSQL from a single generated scenario.
/// <para>
/// All three display names are non-empty after trimming, at most 50 characters, and differ after
/// trimming and case-insensitive comparison, so they satisfy the squad's display-name uniqueness
/// rule; the squad name is non-empty after trimming and at most 80 characters; and
/// <paramref name="GracePeriodDays"/> is a whole number of days in the accepted inclusive 1..90
/// range.
/// </para>
/// </summary>
/// <param name="SquadName">A valid squad name (1..80 characters after trimming).</param>
/// <param name="OwnerName">A valid, distinct display name for the squad owner.</param>
/// <param name="SecondName">A valid, distinct display name for a second registered member or guest.</param>
/// <param name="ThirdName">A valid, distinct display name for a third member or guest.</param>
/// <param name="GracePeriodDays">A valid soft-delete grace period in whole days (1..90).</param>
public sealed record SquadDbScenario(
    string SquadName,
    string OwnerName,
    string SecondName,
    string ThirdName,
    int GracePeriodDays);
