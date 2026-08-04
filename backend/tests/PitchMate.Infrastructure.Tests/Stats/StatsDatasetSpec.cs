using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// The abstract, database-free description of a generated stats dataset produced by
/// <see cref="StatsDatasetGenerators"/>. It uses <em>pool indices</em> (not identities) for
/// memberships so FsCheck can generate and shrink it freely; the <see cref="StatsDatasetSeeder"/>
/// turns it into real domain entities (assigning the GUID v7 identities) and materialises it into a
/// <c>PitchMateDbContext</c>, returning the resolved <see cref="SeededStatsDataset"/> the reference
/// <see cref="StatsReferenceOracle"/> and the model-based property tests (tasks 6.2–6.11) consume.
/// <para>
/// The generated matches deliberately span every <see cref="MatchState"/> (so completed-only
/// derivation can be exercised), use two- or three-team, evenly- or unevenly-sized kickoff lineups
/// with a single bib team, and reuse a shared membership pool across matches so teammates and
/// opponents recur. Memberships may be guests, may become <c>Inactive</c>, and may be anonymised, and
/// may carry a current rating or none — covering the profile/leaderboard edge cases the properties
/// rely on.
/// </para>
/// </summary>
/// <param name="Squads">The squads in the dataset; more than one lets squad-isolation be tested.</param>
public sealed record StatsDatasetSpec(IReadOnlyList<StatsDatasetSpec.SquadSpec> Squads)
{
    /// <summary>
    /// One squad: whether it has live-match tracking enabled (which gates <c>Rich</c> results), its
    /// pool of memberships, and its matches.
    /// </summary>
    /// <param name="LiveMatchTracking">Whether the squad has the <c>LiveMatchTracking</c> feature enabled.</param>
    /// <param name="Members">The squad's membership pool; matches draw their rosters from these by index.</param>
    /// <param name="Matches">The squad's matches, spanning every <see cref="MatchState"/>.</param>
    public sealed record SquadSpec(
        bool LiveMatchTracking,
        IReadOnlyList<MembershipSpec> Members,
        IReadOnlyList<MatchSpec> Matches);

    /// <summary>
    /// One membership in the pool. Lifecycle transforms are applied <em>after</em> the matches are
    /// built, so an <c>Inactive</c> or anonymised membership still contributes its history to the
    /// de-identified aggregates other players depend on (Requirement 14).
    /// </summary>
    /// <param name="IsGuest">Whether the membership is a guest (no backing user).</param>
    /// <param name="Inactive">Whether the membership is deactivated after its matches are built.</param>
    /// <param name="Anonymise">Whether the membership is anonymised after its matches are built.</param>
    /// <param name="Rating">The membership's current rating, or <see langword="null"/> when it has none.</param>
    public sealed record MembershipSpec(
        bool IsGuest,
        bool Inactive,
        bool Anonymise,
        RatingSpec? Rating);

    /// <summary>A current-rating (μ, σ) seed for a membership.</summary>
    /// <param name="Mu">The mean skill estimate (μ).</param>
    /// <param name="Sigma">The uncertainty of the estimate (σ); strictly positive.</param>
    public sealed record RatingSpec(double Mu, double Sigma);

    /// <summary>
    /// One match. For a teamless state (<see cref="MatchState.GatheringAvailability"/>,
    /// <see cref="MatchState.Confirmed"/>, <see cref="MatchState.Cancelled"/>) the team fields are
    /// ignored; for a rolled state (<see cref="MatchState.TeamsRolled"/>,
    /// <see cref="MatchState.InProgress"/>, <see cref="MatchState.Completed"/>) the rosters are drawn
    /// from the pool by a deterministic shuffle and split by <see cref="TeamSizes"/>.
    /// </summary>
    /// <param name="State">The lifecycle state the match is driven to.</param>
    /// <param name="Fidelity">The result fidelity; <c>Rich</c> is only generated when the squad tracks live.</param>
    /// <param name="TeamSizes">The size of each team (each 5..8); its length is the team count.</param>
    /// <param name="ShuffleSeed">Seeds the deterministic shuffle that picks each team's roster from the pool.</param>
    /// <param name="Scores">Each team's final score (parallel to <see cref="TeamSizes"/>), used for completed matches.</param>
    /// <param name="BibTeamIndex">The index of the single bib-wearing team.</param>
    /// <param name="CompletedOffsetSeconds">Offsets the completion instant so matches order (and occasionally tie) deterministically.</param>
    public sealed record MatchSpec(
        MatchState State,
        ResultFidelity Fidelity,
        IReadOnlyList<int> TeamSizes,
        int ShuffleSeed,
        IReadOnlyList<int> Scores,
        int BibTeamIndex,
        int CompletedOffsetSeconds);
}
