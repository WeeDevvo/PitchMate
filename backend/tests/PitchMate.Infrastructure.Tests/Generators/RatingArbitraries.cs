using FsCheck;
using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the rating-engine value types,
/// backed by the valid generators in <see cref="RatingGenerators"/>. Reference this class
/// from a property test to feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(RatingArbitraries) })]</code>
/// </summary>
public static class RatingArbitraries
{
    /// <summary>Valid <see cref="Rating"/> values (finite μ, strictly positive σ).</summary>
    public static Arbitrary<Rating> Rating() => Arb.From(RatingGenerators.ValidRating());

    /// <summary>Valid <see cref="RatingEngineConfig"/> values (all validation rules satisfied).</summary>
    public static Arbitrary<RatingEngineConfig> RatingEngineConfig() =>
        Arb.From(RatingGenerators.ValidConfig());

    /// <summary>Valid <see cref="MatchOutcome"/> values (2+ teams, ≥1 player, uneven sizes, tied ranks).</summary>
    public static Arbitrary<MatchOutcome> MatchOutcome() =>
        Arb.From(RatingGenerators.ValidMatchOutcome());

    /// <summary>Valid <see cref="TeamRoster"/> values for prediction inputs.</summary>
    public static Arbitrary<TeamRoster> TeamRoster() => Arb.From(RatingGenerators.ValidTeamRoster());
}
