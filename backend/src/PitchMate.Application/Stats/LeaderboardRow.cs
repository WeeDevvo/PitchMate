using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Stats;

/// <summary>
/// One membership's ranking data for a leaderboard query, already scoped to the squad, filtered to
/// completed matches, and filtered for eligibility (Requirement 4.1, 4.4, 4.5). Because streak
/// statistics are reduced by a pure fold rather than by SQL, a row carries the value in one of two
/// shapes: <see cref="Value"/> holds the precomputed number for counting, percentage, and display
/// statistics already reduced by the store, while <see cref="Results"/> holds the membership's ordered
/// <see cref="PlayerResult"/> sequence for a streak statistic so the handler can apply the fold.
/// Exactly one of the two is populated for a given query. <see cref="DisplayName"/> is the
/// "Former player" placeholder for an anonymised membership, whose value is still retained
/// (Requirement 4.6).
/// </summary>
/// <param name="MembershipId">The membership's identity.</param>
/// <param name="DisplayName">The membership's display name within the squad.</param>
/// <param name="State">The membership's lifecycle state.</param>
/// <param name="Value">The precomputed value for a non-streak statistic, or <see langword="null"/> for a streak statistic.</param>
/// <param name="Results">The ordered result sequence for a streak statistic, or <see langword="null"/> for a non-streak statistic.</param>
public sealed record LeaderboardRow(
    Guid MembershipId,
    string DisplayName,
    MembershipState State,
    double? Value,
    IReadOnlyList<PlayerResult>? Results);
