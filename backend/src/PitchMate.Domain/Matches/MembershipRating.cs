using PitchMate.Domain.Common;

// Alias the rating value type: within PitchMate.Domain.Matches the unqualified name `Rating`
// otherwise binds to the sibling namespace PitchMate.Domain.Rating rather than the Rating record.
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The persistent squad-scoped current rating (μ, σ) that hangs off a single
/// <see cref="PitchMate.Domain.Squads.SquadMembership"/> in a one-to-one relationship
/// (<c>structure.md</c> "membership-centric ratings", Requirement 12.1). The rating hangs off the
/// membership rather than the user, so a membership's rating history survives a guest claim, a leave,
/// or a rejoin.
/// <para>
/// It is modelled as a separate entity keyed 1:1 on the membership — rather than as fields on
/// <see cref="PitchMate.Domain.Squads.SquadMembership"/> — so match-lifecycle owns its rating state
/// without reaching into another aggregate's entity. The current rating is seeded lazily from the
/// membership's <see cref="PitchMate.Domain.Rating.SkillTier"/> via
/// <see cref="PitchMate.Domain.Rating.IRatingEngine.CreateRating"/> the first time a member
/// participates, and is updated in the atomic completion transaction after a match's single rating
/// update (Requirement 12.1). Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit
/// fields, and soft-delete state, and the type uses only the base class library and existing Domain
/// types, keeping Domain free of framework concerns (Requirement 16.1).
/// </para>
/// </summary>
public sealed class MembershipRating : BaseEntity
{
    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private MembershipRating()
    {
    }

    private MembershipRating(Guid squadMembershipId, double mu, double sigma)
    {
        SquadMembershipId = squadMembershipId;
        Mu = mu;
        Sigma = sigma;
    }

    /// <summary>The identity of the squad membership this rating hangs off, one-to-one (Requirement 12.1).</summary>
    public Guid SquadMembershipId { get; private set; }

    /// <summary>The current mean skill estimate (μ).</summary>
    public double Mu { get; private set; }

    /// <summary>The current uncertainty of the estimate (σ); strictly positive in valid ratings.</summary>
    public double Sigma { get; private set; }

    /// <summary>The current rating as a <see cref="PlayerRating"/> value, projecting <see cref="Mu"/> and <see cref="Sigma"/>.</summary>
    public PlayerRating Rating => new(Mu, Sigma);

    /// <summary>
    /// Creates the current-rating record for <paramref name="squadMembershipId"/> seeded with
    /// <paramref name="rating"/>, the value produced by
    /// <see cref="PitchMate.Domain.Rating.IRatingEngine.CreateRating"/> from the membership's skill
    /// tier on first participation (Requirement 12.1).
    /// </summary>
    /// <param name="squadMembershipId">The identity of the squad membership this rating hangs off.</param>
    /// <param name="rating">The seed rating (μ, σ) for the membership.</param>
    /// <returns>A new membership rating carrying the seed rating.</returns>
    public static MembershipRating Create(Guid squadMembershipId, PlayerRating rating) =>
        new(squadMembershipId, rating.Mu, rating.Sigma);

    /// <summary>
    /// Overwrites the current rating with <paramref name="rating"/>, the engine's output for this
    /// membership after a match's single rating update, applied within the atomic completion
    /// transaction (Requirement 12.1).
    /// </summary>
    /// <param name="rating">The new current rating (μ, σ) produced by the rating engine.</param>
    public void UpdateRating(PlayerRating rating)
    {
        Mu = rating.Mu;
        Sigma = rating.Sigma;
    }
}
