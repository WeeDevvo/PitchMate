using PitchMate.Application.Stats;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// An <see cref="IStatsRepository"/> stand-in that reports no ranking rows for any squad and any
/// statistic, so the leaderboard endpoint can be driven without a database.
/// <para>
/// The leaderboard query-binding test reads which statistic bound off the <c>statistic</c> member of
/// the <c>Leaderboard</c> body — a value the handler carries through from the bound command — so the
/// rows themselves are irrelevant to it and an empty result keeps the stand-in honest rather than
/// inventing statistics.
/// </para>
/// </summary>
internal sealed class EmptyLeaderboardStatsRepository : IStatsRepository
{
    /// <inheritdoc />
    public Task<IReadOnlyList<LeaderboardRow>> GetLeaderboardRowsAsync(
        Guid squadId, LeaderboardStatistic statistic, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<LeaderboardRow>>([]);

    /// <inheritdoc />
    public Task<MembershipStatsData?> GetMembershipStatsAsync(Guid squadId, Guid membershipId, CancellationToken ct) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<MembershipRef?> FindMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct) =>
        throw Unsupported();

    private static NotSupportedException Unsupported() => new(
        "This stats repository stand-in supports only GetLeaderboardRowsAsync; "
            + "the leaderboard query-binding test drives no profile read.");
}
