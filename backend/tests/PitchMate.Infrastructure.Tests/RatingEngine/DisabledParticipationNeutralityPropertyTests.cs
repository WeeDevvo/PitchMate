using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for participation-weighting neutrality on
/// <see cref="PlackettLuceRatingEngine.UpdateRatings"/>. With participation weighting DISABLED (the
/// shipped default), the participation values carried on each <see cref="PlayerInput"/> must have no
/// effect whatsoever: updating a <see cref="MatchOutcome"/> whose players carry arbitrary participation
/// values — including missing, out-of-range, and non-finite values that the enabled lever would reject —
/// must produce μ/σ results that are exactly equal, value-for-value, to updating the same outcome with
/// no participation values supplied. This proves the disabled update ignores participation entirely:
/// no validation and no interpolation (Requirement 7.2).
/// </summary>
public class DisabledParticipationNeutralityPropertyTests
{
    // Feature: rating-engine, Property 15: Participation weighting is neutral when disabled
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property ParticipationWeightingIsNeutralWhenDisabled(
        RatingEngineConfig config,
        MatchOutcome outcome,
        int participationSeed)
    {
        // Force the lever off regardless of what the config generator produced. The default is already
        // false, but pinning it here makes the "disabled" precondition explicit (Requirement 7.1/7.2).
        var disabledConfig = config with { ParticipationWeightingEnabled = false };
        var engine = new PlackettLuceRatingEngine(disabledConfig);

        // The generated outcome carries no participation values. Build a second outcome whose players
        // carry arbitrary participation values derived from the seed — deliberately including values the
        // enabled lever would reject (null, < 0, > 1, NaN, ±∞). Because the lever is disabled, none of
        // these may influence the result, nor trigger a validation error (Requirement 7.2).
        var withParticipation = AttachParticipation(outcome, participationSeed);

        var withValues = engine.UpdateRatings(withParticipation);
        var withoutValues = engine.UpdateRatings(outcome);

        // A valid outcome updates successfully in both cases; the participation values must not change
        // that — in particular, the out-of-range / non-finite values must NOT produce a validation error
        // because the lever is disabled.
        if (!withValues.IsSuccess || !withoutValues.IsSuccess)
        {
            return false.ToProperty();
        }

        // Disabled weighting => bit-identical results, so compare μ/σ with exact equality (not a
        // tolerance): the participation values must be ignored entirely (Requirement 7.2).
        return ResultsExactlyEqual(withValues.Value!, withoutValues.Value!).ToProperty();
    }

    /// <summary>
    /// Returns a copy of <paramref name="outcome"/> in which every player carries a participation value
    /// derived from <paramref name="seed"/>. The candidate values span the whole space — valid ([0, 1]),
    /// out-of-range (negative, &gt; 1), non-finite (NaN, ±∞), and missing (null) — so the test exercises
    /// values the enabled lever would reject and proves the disabled path ignores all of them.
    /// </summary>
    private static MatchOutcome AttachParticipation(MatchOutcome outcome, int seed)
    {
        // A small palette of participation values, including ones the enabled lever rejects.
        double?[] palette =
        {
            null,
            0.0,
            0.5,
            1.0,
            -0.25,
            1.5,
            double.NaN,
            double.PositiveInfinity,
            double.NegativeInfinity
        };

        // A simple, deterministic per-player walk through the palette so different players get
        // different values without relying on randomness inside the test.
        var counter = seed;
        var teams = new List<TeamResult>(outcome.Teams.Count);
        foreach (var team in outcome.Teams)
        {
            var players = new List<PlayerInput>(team.Players.Count);
            foreach (var player in team.Players)
            {
                var index = (int)(((uint)counter) % (uint)palette.Length);
                counter++;
                players.Add(player with { Participation = palette[index] });
            }

            teams.Add(team with { Players = players });
        }

        return outcome with { Teams = teams };
    }

    /// <summary>
    /// True when two <see cref="MatchUpdate"/>s have the same team/player shape and every corresponding
    /// rating is equal value-for-value (exact μ and σ equality).
    /// </summary>
    private static bool ResultsExactlyEqual(MatchUpdate left, MatchUpdate right)
    {
        if (left.Teams.Count != right.Teams.Count)
        {
            return false;
        }

        for (var i = 0; i < left.Teams.Count; i++)
        {
            var leftTeam = left.Teams[i];
            var rightTeam = right.Teams[i];

            if (leftTeam.Count != rightTeam.Count)
            {
                return false;
            }

            for (var j = 0; j < leftTeam.Count; j++)
            {
                // Exact equality: the disabled lever path performs no participation-dependent
                // arithmetic, so the two updates must be identical down to the bit.
                if (leftTeam[j].Mu != rightTeam[j].Mu || leftTeam[j].Sigma != rightTeam[j].Sigma)
                {
                    return false;
                }
            }
        }

        return true;
    }
}
