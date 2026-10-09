using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

// The squad and rating namespaces each declare their own Result<T>; alias the rating types this test
// needs so the two triads are never confused (the same idiom the squad standing fakes use).
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using RatingEngineConfig = PitchMate.Domain.Rating.RatingEngineConfig;
using RatingState = PitchMate.Domain.Rating.RatingState;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based test for the <i>source</i> of the rating-state signal on a
/// <see cref="SquadMemberView"/> (api-response-contracts Property 18). Where Property 17 checks that
/// each standing lands on the right membership, this one checks that the classification the view
/// reports is the one the injected <see cref="IRatingEngine"/> reports — not a σ threshold restated in
/// the Application layer (Requirement 10.3, 11.6).
/// <para>
/// The oracle is the engine itself: the expected value is obtained by calling
/// <see cref="IRatingEngine.GetState"/> for the same <see cref="PlayerRating"/>, never by comparing a
/// σ against a number written in this test. The engine's threshold is varied across values that all
/// <b>disagree</b> with the Domain default, and each generated case is required to contain a σ that the
/// injected threshold and the Domain default classify differently — so a threshold hard-coded in
/// production code would fail this property rather than pass it.
/// </para>
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class GetSquadRatingStateProperties
{
    /// <summary>The smallest membership set the generator emits (the non-vacuity floor).</summary>
    private const int MinMembers = 4;

    // Feature: api-response-contracts, Property 18: The rating state signal is the Domain classification
    // - for any μ/σ pair, the rating state reported on a member view equals what IRatingEngine.GetState
    // reports for that rating: the engine's classification where it succeeds, and no rating state where
    // the engine reports a failure (a non-finite μ/σ) or where the membership has no rating at all.
    // Validates: Requirement 10.3
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(RatingClassificationGenerators) })]
    [Trait("Property", "18")]
    public Property Property18_RatingStateIsTheEngineClassification(RatingClassificationScenario scenario)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid readerUserId = Guid.NewGuid();
        var standing = new Dictionary<Guid, MembershipStanding>();
        var samples = new Dictionary<Guid, RatingSample>();

        for (int i = 0; i < scenario.Samples.Count; i++)
        {
            RatingSample sample = scenario.Samples[i];
            SquadMembership membership = i == 0
                ? SquadMembership.CreateRegistered(squad.Id, readerUserId, "Reader").Value!
                : SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), $"Member{i}").Value!;

            store.AddCommittedMembership(membership);
            samples[membership.Id] = sample;

            if (sample.PresentInStanding)
            {
                standing[membership.Id] = new MembershipStanding(i, sample.Mu, sample.Sigma);
            }
        }

        // The engine under injection and the oracle are configured identically but are separate
        // instances, so the oracle's calls cannot perturb what the handler observed.
        var injected = new SquadThresholdRatingEngine(scenario.Threshold);
        var oracle = new SquadThresholdRatingEngine(scenario.Threshold);

        // A second engine standing in for "the threshold someone might hard-code": the Domain default.
        // It is never the oracle — it exists only to prove the generated case can tell the two apart.
        var domainDefault = new SquadThresholdRatingEngine(new RatingEngineConfig().ProvisionalThreshold);

        var handler = new GetSquadHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store),
            new FakeMembershipStandingSource().WithStanding(squad.Id, standing),
            injected);

        Result<SquadData> result = handler
            .HandleAsync(new GetSquadCommand(readerUserId, squad.Id), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // Non-vacuity floor: the case must carry a membership set of the expected size, the read must
        // have succeeded, and the generated μ/σ pairs must exercise all three answers the engine can
        // give (an established rating, a provisional one, and a classification failure) plus at least
        // one σ on which the injected threshold and the Domain default disagree. Without the last
        // conjunct a hard-coded default threshold could satisfy every assertion below.
        int established = 0;
        int provisional = 0;
        int failed = 0;
        int discriminating = 0;

        foreach (RatingSample sample in scenario.Samples)
        {
            RatingState? expected = Classify(oracle, sample);

            switch (expected)
            {
                case RatingState.Established:
                    established++;
                    break;
                case RatingState.Provisional:
                    provisional++;
                    break;
                default:
                    if (HasRating(sample))
                    {
                        failed++;
                    }

                    break;
            }

            if (HasRating(sample) && expected != Classify(domainDefault, sample))
            {
                discriminating++;
            }
        }

        bool floorHolds =
            scenario.Samples.Count >= MinMembers
            && result.IsSuccess
            && result.Value!.Members.Count == scenario.Samples.Count
            && established >= 1
            && provisional >= 1
            && failed >= 1
            && discriminating >= 1;

        if (!floorHolds)
        {
            return false
                .ToProperty()
                .Label($"non-vacuity floor failed: threshold={scenario.Threshold}, "
                    + $"samples={scenario.Samples.Count}, success={result.IsSuccess}, "
                    + $"views={result.Value?.Members.Count}, established={established}, "
                    + $"provisional={provisional}, failed={failed}, discriminating={discriminating}");
        }

        // 10.3: the state each view reports is the state the injected engine reports for that same
        // rating — asked of the engine, never re-derived from a threshold here.
        SquadMemberView? mismatch = result.Value!.Members
            .FirstOrDefault(v => v.RatingState != Classify(oracle, samples[v.MembershipId]));

        if (mismatch is not null)
        {
            RatingSample sample = samples[mismatch.MembershipId];

            return false
                .ToProperty()
                .Label($"threshold={scenario.Threshold}, μ={sample.Mu}, σ={sample.Sigma}, "
                    + $"present={sample.PresentInStanding}: view reported {mismatch.RatingState}, "
                    + $"engine reported {Classify(oracle, sample)}");
        }

        // The handler must have consulted the engine for every membership that has a rating, rather
        // than short-circuiting some of them through a comparison of its own.
        int ratingsPresented = scenario.Samples.Count(HasRating);
        bool engineConsultedForEveryRating = injected.GetStateCallCount == ratingsPresented;

        return engineConsultedForEveryRating
            .ToProperty()
            .Label($"threshold={scenario.Threshold}: engine consulted {injected.GetStateCallCount} "
                + $"times for {ratingsPresented} ratings")
            .Collect($"threshold={scenario.Threshold}, discriminating={discriminating}");
    }

    /// <summary>Whether the standing this sample seeds carries a rating at all (both μ and σ).</summary>
    private static bool HasRating(RatingSample sample) =>
        sample.PresentInStanding && sample.Mu is not null && sample.Sigma is not null;

    /// <summary>
    /// What the given engine says about this sample's rating: its classification where it succeeds, and
    /// no state where the engine reports a failure or the sample carries no rating.
    /// </summary>
    private static RatingState? Classify(IRatingEngine engine, RatingSample sample)
    {
        if (!HasRating(sample))
        {
            return null;
        }

        PitchMate.Domain.Rating.Result<RatingState> state =
            engine.GetState(new PlayerRating(sample.Mu!.Value, sample.Sigma!.Value));

        return state.IsSuccess ? state.Value : null;
    }
}

/// <summary>
/// One membership's seeded standing in the classification property: whether the standing source reports
/// it at all, and the μ/σ it carries when it does (either may be absent, and either may be non-finite
/// so the engine reports a classification failure).
/// </summary>
/// <param name="PresentInStanding">Whether the standing source reports this membership.</param>
/// <param name="Mu">The μ the standing carries, or <see langword="null"/> for none.</param>
/// <param name="Sigma">The σ the standing carries, or <see langword="null"/> for none.</param>
public sealed record RatingSample(bool PresentInStanding, double? Mu, double? Sigma);

/// <summary>
/// One generated case: the σ threshold the injected rating engine classifies against, and the
/// per-membership μ/σ samples to classify under it.
/// </summary>
/// <param name="Threshold">The injected engine's σ threshold.</param>
/// <param name="Samples">One sample per membership, in membership order.</param>
public sealed record RatingClassificationScenario(double Threshold, IReadOnlyList<RatingSample> Samples);

/// <summary>
/// FsCheck arbitraries for the rating-state classification property. The threshold is drawn from values
/// that all differ from the Domain default, and each case is normalised to contain a σ at or below the
/// injected threshold, a σ above it, a σ in the window where the injected threshold and the Domain
/// default disagree, and a non-finite μ/σ the engine cannot classify — the four cases the property's
/// non-vacuity floor requires. Remaining samples are free, including absent standings and partial
/// (μ-only / σ-only) shapes that are not ratings.
/// </summary>
public static class RatingClassificationGenerators
{
    private const int MinMembers = 4;
    private const int MaxMembers = 8;

    /// <summary>The Domain's default σ threshold — the one a hard-coded comparison would most likely use.</summary>
    private static readonly double DomainDefaultThreshold = new RatingEngineConfig().ProvisionalThreshold;

    /// <summary>Candidate thresholds for the injected engine, every one of them unequal to the Domain default.</summary>
    private static readonly double[] Thresholds = [0.5, 1.0, 2.0, 3.0, 6.0, 9.0, 12.0];

    /// <summary>Arbitrary for a classification scenario.</summary>
    public static Arbitrary<RatingClassificationScenario> Scenarios() => Arb.From(ScenarioGen());

    private static Gen<RatingClassificationScenario> ScenarioGen() =>
        from threshold in Gen.Elements(Thresholds)
        from count in Gen.Choose(MinMembers, MaxMembers)
        from free in Gen.ArrayOf(FreeSampleGen(threshold), count)
        from established in EstablishedGen(threshold)
        from provisional in ProvisionalGen(threshold)
        from discriminating in DiscriminatingGen(threshold)
        from unclassifiable in UnclassifiableGen(threshold)
        select new RatingClassificationScenario(
            threshold,
            Normalise(free, established, provisional, discriminating, unclassifiable));

    /// <summary>An unconstrained sample: present or absent, with any combination of μ and σ.</summary>
    private static Gen<RatingSample> FreeSampleGen(double threshold) =>
        from present in Gen.Elements(true, false)
        from carriesMu in Gen.Elements(true, false)
        from carriesSigma in Gen.Elements(true, false)
        from mu in MuGen()
        from sigma in SigmaGen(0.01, Math.Max(threshold, DomainDefaultThreshold) + 5.0)
        select new RatingSample(present, carriesMu ? mu : null, carriesSigma ? sigma : null);

    /// <summary>A rating the injected engine classifies as established: σ at or below its threshold.</summary>
    private static Gen<RatingSample> EstablishedGen(double threshold) =>
        from mu in MuGen()
        from sigma in SigmaGen(0.01, threshold)
        select new RatingSample(true, mu, sigma);

    /// <summary>A rating the injected engine classifies as provisional: σ above its threshold.</summary>
    private static Gen<RatingSample> ProvisionalGen(double threshold) =>
        from mu in MuGen()
        from sigma in SigmaGen(threshold + 0.01, threshold + 5.0)
        select new RatingSample(true, mu, sigma);

    /// <summary>
    /// A rating whose σ falls between the injected threshold and the Domain default, so the injected
    /// engine and a hard-coded default classify it differently.
    /// </summary>
    private static Gen<RatingSample> DiscriminatingGen(double threshold) =>
        from mu in MuGen()
        from sigma in SigmaGen(
            Math.Min(threshold, DomainDefaultThreshold) + 0.01,
            Math.Max(threshold, DomainDefaultThreshold))
        select new RatingSample(true, mu, sigma);

    /// <summary>A rating the engine cannot classify, because μ or σ is not finite.</summary>
    private static Gen<RatingSample> UnclassifiableGen(double threshold) =>
        from which in Gen.Choose(0, 4)
        from mu in MuGen()
        from sigma in SigmaGen(0.01, threshold + 5.0)
        select which switch
        {
            0 => new RatingSample(true, double.NaN, sigma),
            1 => new RatingSample(true, mu, double.NaN),
            2 => new RatingSample(true, double.PositiveInfinity, sigma),
            3 => new RatingSample(true, mu, double.NegativeInfinity),
            _ => new RatingSample(true, double.NegativeInfinity, double.PositiveInfinity)
        };

    /// <summary>A finite μ in [-50, 50]; μ never affects the classification, only σ does.</summary>
    private static Gen<double> MuGen() => Gen.Choose(-5_000, 5_000).Select(hundredths => hundredths / 100.0);

    /// <summary>
    /// A σ in the closed band <c>[lower, upper]</c>, generated in hundredths so the bound the caller
    /// asked for is respected exactly rather than approached.
    /// </summary>
    private static Gen<double> SigmaGen(double lower, double upper)
    {
        int low = (int)Math.Ceiling(lower * 100.0);
        int high = (int)Math.Floor(upper * 100.0);

        return Gen.Choose(low, Math.Max(low, high)).Select(hundredths => hundredths / 100.0);
    }

    /// <summary>
    /// Places the four required samples at the head of the set: index 0 is the reading user's
    /// membership and carries the established rating, then the provisional, the discriminating, and the
    /// unclassifiable one. Every later membership keeps its freely generated sample.
    /// </summary>
    private static IReadOnlyList<RatingSample> Normalise(
        RatingSample[] free,
        RatingSample established,
        RatingSample provisional,
        RatingSample discriminating,
        RatingSample unclassifiable)
    {
        free[0] = established;
        free[1] = provisional;
        free[2] = discriminating;
        free[3] = unclassifiable;
        return free;
    }
}
