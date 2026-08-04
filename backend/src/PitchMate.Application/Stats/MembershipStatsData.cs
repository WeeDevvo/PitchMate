using PitchMate.Domain.Stats;

namespace PitchMate.Application.Stats;

/// <summary>
/// The raw, per-membership aggregates a <see cref="PlayerProfile"/> is shaped from, gathered by a
/// single squad-scoped, <c>Completed</c>-only aggregation over the normalised match record
/// (Requirement 2.5). It carries only counts and compact ordered sequences referencing Domain and the
/// BCL; the profile handler applies the Domain calculators (win percentage, streaks, rating summary,
/// progression) to turn it into the final read-model DTO. The companion row records
/// (<see cref="RatingSnapshotRow"/>, <see cref="CoAppearanceRow"/>, <see cref="PairedStatRow"/>) are
/// nested because they are meaningful only as part of these aggregates.
/// </summary>
/// <param name="Appearances">Count of distinct completed matches the membership appeared in.</param>
/// <param name="Wins">Count of <see cref="PlayerResult.Win"/> results across appearances.</param>
/// <param name="Draws">Count of <see cref="PlayerResult.Draw"/> results across appearances.</param>
/// <param name="Losses">Count of <see cref="PlayerResult.Loss"/> results across appearances.</param>
/// <param name="Results">
/// The membership's chronological <see cref="PlayerResult"/> sequence (one per appearance, ordered by
/// completion instant then match identity) for the pure streak fold.
/// </param>
/// <param name="Snapshots">
/// The membership's rating snapshot rows, ordered chronologically, for the rating progression.
/// </param>
/// <param name="Mu">The current mean skill estimate (μ), or <see langword="null"/> when the membership has no rating.</param>
/// <param name="Sigma">The current uncertainty (σ), or <see langword="null"/> when the membership has no rating.</param>
/// <param name="BibAppearances">Count of completed matches in which the membership's kickoff team wore bibs.</param>
/// <param name="CoAppearances">
/// One row per other membership the subject has shared a completed match with, carrying both the
/// same-team (teammate) and opposing (opponent) co-appearance counts.
/// </param>
/// <param name="Partnerships">
/// One row per teammate the subject has shared a kickoff team with, carrying the win/qualifying-match
/// numerator and denominator so the handler can compute the partnership win percentage.
/// </param>
/// <param name="BogeyOpponents">
/// One row per opponent the subject has faced on a different kickoff team, carrying the
/// win/qualifying-match numerator and denominator so the handler can compute the win percentage.
/// </param>
public sealed record MembershipStatsData(
    int Appearances,
    int Wins,
    int Draws,
    int Losses,
    IReadOnlyList<PlayerResult> Results,
    IReadOnlyList<MembershipStatsData.RatingSnapshotRow> Snapshots,
    double? Mu,
    double? Sigma,
    int BibAppearances,
    IReadOnlyList<MembershipStatsData.CoAppearanceRow> CoAppearances,
    IReadOnlyList<MembershipStatsData.PairedStatRow> Partnerships,
    IReadOnlyList<MembershipStatsData.PairedStatRow> BogeyOpponents)
{
    /// <summary>
    /// One rating snapshot for the membership — the μ/σ recorded when a completed match finished,
    /// carried in chronological order for the rating progression (Requirement 8.1, 8.2, 8.3, 8.6).
    /// </summary>
    /// <param name="CompletedAt">The completion instant of the match that produced the snapshot.</param>
    /// <param name="MatchId">The match that produced the snapshot; the secondary ordering key.</param>
    /// <param name="Mu">The snapshot's mean skill estimate (μ).</param>
    /// <param name="Sigma">The snapshot's uncertainty (σ).</param>
    public sealed record RatingSnapshotRow(DateTimeOffset CompletedAt, Guid MatchId, double Mu, double Sigma);

    /// <summary>
    /// The subject's co-appearance counts with one other membership: the number of completed matches
    /// shared on the same kickoff team (<paramref name="TeammateCount"/>) and on different kickoff
    /// teams (<paramref name="OpponentCount"/>) — shaping "most played with" and "most played against"
    /// (Requirement 10.1, 10.2). <paramref name="DisplayName"/> is the "Former player" placeholder for
    /// an anonymised membership.
    /// </summary>
    /// <param name="MembershipId">The other membership's identity.</param>
    /// <param name="DisplayName">The other membership's display name within the squad.</param>
    /// <param name="TeammateCount">Completed matches shared on the same kickoff team.</param>
    /// <param name="OpponentCount">Completed matches shared on different kickoff teams.</param>
    public sealed record CoAppearanceRow(Guid MembershipId, string DisplayName, int TeammateCount, int OpponentCount);

    /// <summary>
    /// The win/qualifying-match numerator and denominator for the subject over the matches shared with
    /// one other membership — on the same team for a partnership, on different teams for a bogey
    /// opponent — so the handler can compute the win percentage via the Domain
    /// <c>WinPercentage</c> calculator (Requirement 11.1, 11.2). <paramref name="DisplayName"/> is the
    /// "Former player" placeholder for an anonymised membership.
    /// </summary>
    /// <param name="MembershipId">The other membership's identity.</param>
    /// <param name="DisplayName">The other membership's display name within the squad.</param>
    /// <param name="Wins">The subject's wins across the qualifying subset of shared matches (numerator).</param>
    /// <param name="QualifyingMatches">The count of completed matches in the qualifying subset (denominator).</param>
    public sealed record PairedStatRow(Guid MembershipId, string DisplayName, int Wins, int QualifyingMatches);
}
