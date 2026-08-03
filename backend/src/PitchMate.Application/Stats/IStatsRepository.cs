namespace PitchMate.Application.Stats;

/// <summary>
/// Squad-scoped, read-only aggregation over the normalised match record for the stats surface.
/// Declared in Application so the stats use cases stay free of EF Core / Npgsql types; implemented in
/// Infrastructure over the <c>PitchMateDbContext</c>. Every aggregate is scoped to a single squad,
/// filtered to <c>MatchState.Completed</c>, and pushed into the relational store — no stats are
/// materialised in memory across a whole squad and no denormalised summary is read
/// (Requirement 2.1, 2.3, 2.5, 13.3, 13.4, 13.5).
/// </summary>
public interface IStatsRepository
{
    /// <summary>
    /// Retrieves the compact per-membership aggregates a Profile is shaped from — appearance and
    /// win/draw/loss counts, the ordered <c>PlayerResult</c> sequence for the streak fold, the ordered
    /// rating snapshot rows for progression, current μ/σ (or none), bib appearance count, and the
    /// co-appearance and partnership/bogey rows — or <see langword="null"/> when the membership does
    /// not belong to <paramref name="squadId"/>. The handler applies the Domain calculators to shape
    /// the final DTO (Requirement 2.5).
    /// </summary>
    /// <param name="squadId">The squad the statistics are scoped to.</param>
    /// <param name="membershipId">The subject membership whose aggregates are read.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The subject's aggregates, or <see langword="null"/> when it is not a member of the squad.</returns>
    Task<MembershipStatsData?> GetMembershipStatsAsync(Guid squadId, Guid membershipId, CancellationToken ct);

    /// <summary>
    /// Retrieves the per-membership values for the selected ranking <paramref name="statistic"/>,
    /// already scoped to <paramref name="squadId"/>, filtered to completed matches, and filtered for
    /// eligibility (at least one appearance; a present value for percentage/display statistics). For a
    /// streak statistic each row instead carries the membership's ordered <c>PlayerResult</c> sequence
    /// so the handler can apply the pure streak fold (Requirement 4.1, 4.4, 4.5).
    /// </summary>
    /// <param name="squadId">The squad the leaderboard is scoped to.</param>
    /// <param name="statistic">The statistic the rows are ranked by.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The eligible per-membership ranking rows, unordered.</returns>
    Task<IReadOnlyList<LeaderboardRow>> GetLeaderboardRowsAsync(Guid squadId, LeaderboardStatistic statistic, CancellationToken ct);

    /// <summary>
    /// Retrieves a lightweight reference to the subject membership proving it belongs to
    /// <paramref name="squadId"/>, or <see langword="null"/> when the membership does not exist or
    /// belongs to another squad — so the caller can conceal existence with a uniform failure
    /// (Requirement 3.6).
    /// </summary>
    /// <param name="squadId">The squad the membership must belong to.</param>
    /// <param name="membershipId">The subject membership to locate.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The membership reference, or <see langword="null"/> when it is not a member of the squad.</returns>
    Task<MembershipRef?> FindMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct);
}
