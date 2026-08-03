using PitchMate.Domain.Common;

// Alias the rating value type: within PitchMate.Domain.Matches the unqualified name `Rating`
// otherwise binds to the sibling namespace PitchMate.Domain.Rating rather than the Rating record.
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The immutable per-participant rating (μ, σ) captured immediately after a completed match's single
/// rating update — one row per <see cref="MatchParticipant"/> of a completed <see cref="Match"/>,
/// written atomically within the completion transaction (Requirement 12.1). Snapshots provide the
/// μ/σ progression history that the stats/leaderboard and rating-replay use cases read; because each
/// carries the completing <see cref="MatchId"/> and the <see cref="SquadMembershipId"/> it belongs to,
/// the sequence of a membership's snapshots reconstructs its rating over time.
/// <para>
/// A snapshot is written only on the first successful completion of a match; an idempotent
/// re-completion writes no further snapshot, so a membership never accrues a duplicate snapshot for
/// the same match (Requirement 12.7, 13.5, 10.5). Deriving from <see cref="BaseEntity"/> supplies the
/// GUID v7 key and audit fields, and the type uses only the base class library and existing Domain
/// types, keeping Domain free of framework concerns (Requirement 16.1).
/// </para>
/// </summary>
public sealed class RatingSnapshot : BaseEntity
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private RatingSnapshot()
    {
    }

    private RatingSnapshot(Guid matchId, Guid squadMembershipId, double mu, double sigma)
    {
        MatchId = matchId;
        SquadMembershipId = squadMembershipId;
        Mu = mu;
        Sigma = sigma;
    }

    /// <summary>The identity of the completed match whose rating update produced this snapshot (Requirement 12.1).</summary>
    public Guid MatchId { get; private set; }

    /// <summary>The identity of the squad membership this snapshot records the post-update rating for (Requirement 12.1).</summary>
    public Guid SquadMembershipId { get; private set; }

    /// <summary>The mean skill estimate (μ) immediately after the match's rating update.</summary>
    public double Mu { get; private set; }

    /// <summary>The uncertainty of the estimate (σ) immediately after the match's rating update.</summary>
    public double Sigma { get; private set; }

    /// <summary>The snapshotted rating as a <see cref="PlayerRating"/> value, projecting <see cref="Mu"/> and <see cref="Sigma"/>.</summary>
    public PlayerRating Rating => new(Mu, Sigma);

    /// <summary>
    /// Captures the post-update rating <paramref name="rating"/> for participant
    /// <paramref name="squadMembershipId"/> of match <paramref name="matchId"/> as one immutable
    /// snapshot row, written within the completion transaction (Requirement 12.1).
    /// </summary>
    /// <param name="matchId">The identity of the completing match.</param>
    /// <param name="squadMembershipId">The identity of the participant membership the snapshot belongs to.</param>
    /// <param name="rating">The participant's rating (μ, σ) immediately after the rating update.</param>
    /// <returns>A new snapshot carrying the post-update rating.</returns>
    public static RatingSnapshot Capture(Guid matchId, Guid squadMembershipId, PlayerRating rating) =>
        new(matchId, squadMembershipId, rating.Mu, rating.Sigma);
}
