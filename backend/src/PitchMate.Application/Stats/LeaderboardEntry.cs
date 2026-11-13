using PitchMate.Domain.Rating;

namespace PitchMate.Application.Stats;

/// <summary>
/// One ranked row of a squad <c>Leaderboard</c>: a membership's identity, its display name, and the
/// value of the selected ranking statistic (Requirement 4.1). Entries are ordered best-first by
/// value, ties broken by ascending membership identity. The <see cref="DisplayName"/> is the
/// "Former player" placeholder for an anonymised membership, whose computed value is still retained
/// (Requirement 4.6). On the display-rating leaderboard each entry also carries its
/// <see cref="RatingState"/>, so a client can show the settling note beside a ranked player whose
/// rating has not settled; on every other leaderboard it is <see langword="null"/>.
/// </summary>
/// <param name="MembershipId">The membership's identity.</param>
/// <param name="DisplayName">The membership's display name within the squad.</param>
/// <param name="Value">The value of the selected ranking statistic for this membership.</param>
/// <param name="RatingState">The rating's classification on the display-rating leaderboard, otherwise <see langword="null"/>.</param>
public sealed record LeaderboardEntry(Guid MembershipId, string DisplayName, double Value, RatingState? RatingState);
