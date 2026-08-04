using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// The resolved, identity-bearing view of a dataset the <see cref="StatsDatasetSeeder"/> has
/// materialised into a <c>PitchMateDbContext</c>. Every value here mirrors exactly what was persisted
/// — the assigned GUID v7 identities, the frozen team rosters and recorded scores, the current
/// ratings, and the per-completed-match snapshots — so it is a faithful in-memory copy of the
/// database contents. The reference <see cref="StatsReferenceOracle"/> computes the expected
/// statistics from this model, and the model-based property tests (tasks 6.2–6.11) compare that
/// against the real <c>EfStatsRepository</c> reading the same database.
/// </summary>
/// <param name="Squads">The seeded squads, in generation order.</param>
public sealed record SeededStatsDataset(IReadOnlyList<SeededStatsDataset.SquadData> Squads)
{
    /// <summary>Returns the seeded squad at <paramref name="index"/> in generation order.</summary>
    /// <param name="index">The zero-based squad index.</param>
    public SquadData SquadAt(int index) => Squads[index];

    /// <summary>One seeded squad: its identity, live-tracking flag, memberships, and matches.</summary>
    /// <param name="SquadId">The squad's assigned identity.</param>
    /// <param name="LiveMatchTracking">Whether the squad has the <c>LiveMatchTracking</c> feature enabled.</param>
    /// <param name="Memberships">Every membership in the squad, with its final (post-transform) state.</param>
    /// <param name="Matches">Every match in the squad, across all states.</param>
    public sealed record SquadData(
        Guid SquadId,
        bool LiveMatchTracking,
        IReadOnlyList<MembershipData> Memberships,
        IReadOnlyList<MatchData> Matches);

    /// <summary>
    /// One seeded membership in its final persisted state: its identity, its display name (already the
    /// "Former player" placeholder when anonymised), lifecycle state, guest discriminator (which an
    /// anonymised registered membership acquires because anonymisation clears the backing user), and
    /// its current rating (μ, σ) or none.
    /// </summary>
    /// <param name="MembershipId">The membership's assigned identity.</param>
    /// <param name="DisplayName">The membership's persisted display name.</param>
    /// <param name="State">The membership's lifecycle state.</param>
    /// <param name="IsGuest">Whether the membership has no backing user (a guest, or an anonymised membership).</param>
    /// <param name="IsAnonymised">Whether the membership was anonymised.</param>
    /// <param name="Mu">The current mean skill estimate (μ), or <see langword="null"/> when it has no rating.</param>
    /// <param name="Sigma">The current uncertainty (σ), or <see langword="null"/> when it has no rating.</param>
    public sealed record MembershipData(
        Guid MembershipId,
        string DisplayName,
        MembershipState State,
        bool IsGuest,
        bool IsAnonymised,
        double? Mu,
        double? Sigma);

    /// <summary>
    /// One seeded match: its identity, lifecycle state, completion instant (set only when completed),
    /// result fidelity, the frozen kickoff teams (empty for a teamless state), and the per-participant
    /// rating snapshots (present only for a completed match).
    /// </summary>
    /// <param name="MatchId">The match's assigned identity, the secondary chronological ordering key.</param>
    /// <param name="State">The match's lifecycle state; only <see cref="MatchState.Completed"/> contributes to statistics.</param>
    /// <param name="CompletedAt">The completion instant, or <see langword="null"/> when not completed.</param>
    /// <param name="Fidelity">The result fidelity recorded for the match.</param>
    /// <param name="Teams">The frozen kickoff teams (identity, name, bib flag, recorded score, roster).</param>
    /// <param name="Snapshots">The per-participant post-match rating snapshots, for a completed match.</param>
    public sealed record MatchData(
        Guid MatchId,
        MatchState State,
        DateTimeOffset? CompletedAt,
        ResultFidelity Fidelity,
        IReadOnlyList<TeamData> Teams,
        IReadOnlyList<SnapshotData> Snapshots);

    /// <summary>One seeded kickoff team, as the aggregation reads it from the working match-team rows.</summary>
    /// <param name="TeamId">The team's identity, which the recorded per-team scores are keyed on.</param>
    /// <param name="Name">The team's locked, trimmed display name.</param>
    /// <param name="BibFlag">Whether this team wore bibs for the match.</param>
    /// <param name="Score">The team's recorded final score (0 for a match with no recorded result).</param>
    /// <param name="Roster">The ordered squad-membership identities on the team.</param>
    public sealed record TeamData(
        Guid TeamId,
        string Name,
        bool BibFlag,
        int Score,
        IReadOnlyList<Guid> Roster);

    /// <summary>One seeded rating snapshot captured for a participant after a completed match.</summary>
    /// <param name="MembershipId">The membership the snapshot belongs to.</param>
    /// <param name="Mu">The snapshot's mean skill estimate (μ).</param>
    /// <param name="Sigma">The snapshot's uncertainty (σ).</param>
    public sealed record SnapshotData(Guid MembershipId, double Mu, double Sigma);
}
