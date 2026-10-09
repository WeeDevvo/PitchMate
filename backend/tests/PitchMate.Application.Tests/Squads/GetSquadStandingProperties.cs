using System.Reflection;

using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

using RatingState = PitchMate.Domain.Rating.RatingState;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based test for the standing decoration <see cref="GetSquadHandler"/> joins onto each
/// <see cref="SquadMemberView"/> (api-response-contracts Property 17). It drives the real handler
/// against the in-memory squad fakes and the hand-written standing source and rating engine in
/// <c>SquadStandingFakes</c> — no database, no mocking framework — per the Application-layer testing
/// strategy.
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class GetSquadStandingProperties
{
    /// <summary>The σ threshold the test's rating engine classifies against.</summary>
    private const double ProvisionalThreshold = 2.0;

    /// <summary>The smallest membership set the generator emits (the non-vacuity floor).</summary>
    private const int MinMembers = 2;

    /// <summary>The largest membership set the generator emits.</summary>
    private const int MaxMembers = 8;

    /// <summary>
    /// The width of each membership's appearance-count band. Membership <c>i</c> is given a count in
    /// <c>[1 + i·stride, stride + i·stride]</c>, so every present membership's count is distinct from
    /// every other's and from the zero an absent membership must report — a standing joined onto the
    /// wrong membership therefore cannot pass.
    /// </summary>
    private const int AppearanceStride = 40;

    /// <summary>Which of μ and σ a membership's standing carries, and where σ falls.</summary>
    public enum RatingShape
    {
        /// <summary>No rating at all: neither μ nor σ.</summary>
        None,

        /// <summary>μ without σ — not a rating.</summary>
        MuOnly,

        /// <summary>σ without μ — not a rating.</summary>
        SigmaOnly,

        /// <summary>A rating whose σ is at or below the threshold.</summary>
        Established,

        /// <summary>A rating whose σ is above the threshold.</summary>
        Provisional
    }

    // Feature: api-response-contracts, Property 17: Member standing joins onto the right membership and
    // holds its invariants - for any squad, any membership set, and any subset of those memberships
    // present in the standing result, every member view carries an appearance count and a rating-state
    // field; each decoration equals the standing of the membership it sits on; a membership absent from
    // the standing result reports zero appearances and no rating state; every appearance count is
    // non-negative; the rating state is absent exactly when that membership has no rating; no member
    // view carries μ, σ, or a display rating number; and the standing source is called exactly once
    // regardless of squad size.
    // Validates: Requirements 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.9
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(MembershipStandingGenerators) })]
    [Trait("Property", "17")]
    public Property Property17_MemberStandingJoinsOntoTheRightMembership(IReadOnlyList<MemberStandingSpec> specs)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid readerUserId = Guid.NewGuid();
        var standing = new Dictionary<Guid, MembershipStanding>();
        var expected = new Dictionary<Guid, StandingExpectation>();

        for (int i = 0; i < specs.Count; i++)
        {
            MemberStandingSpec spec = specs[i];
            SquadMembership membership = CreateMembership(squad.Id, spec, i, readerUserId);
            store.AddCommittedMembership(membership);

            int appearances = 1 + (i * AppearanceStride) + spec.AppearanceOffset;
            double? mu = CarriesMu(spec.Shape) ? spec.Mu : null;
            double? sigma = CarriesSigma(spec.Shape) ? spec.Sigma : null;

            if (spec.PresentInStanding)
            {
                standing[membership.Id] = new MembershipStanding(appearances, mu, sigma);
            }

            // A membership has a rating only when the standing reports it and carries both μ and σ.
            bool hasRating = spec.PresentInStanding && mu is not null && sigma is not null;
            expected[membership.Id] = new StandingExpectation(
                Appearances: spec.PresentInStanding ? appearances : 0,
                RatingState: hasRating
                    ? sigma! <= ProvisionalThreshold ? RatingState.Established : RatingState.Provisional
                    : null);
        }

        var source = new FakeMembershipStandingSource().WithStanding(squad.Id, standing);
        var handler = new GetSquadHandler(
            new FakeSquadRepository(store),
            new FakeSquadMembershipRepository(store),
            source,
            new SquadThresholdRatingEngine(ProvisionalThreshold));

        Result<SquadData> result = handler
            .HandleAsync(new GetSquadCommand(readerUserId, squad.Id), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // Non-vacuity floor: the generator must have produced a real membership set, at least one of
        // whose memberships the standing source reports, and the read must have succeeded — otherwise
        // every conjunct below would hold trivially.
        int presentCount = specs.Count(s => s.PresentInStanding);
        bool floorHolds =
            specs.Count >= MinMembers
            && presentCount >= 1
            && result.IsSuccess
            && result.Value!.Members.Count == specs.Count;

        if (!floorHolds)
        {
            return false
                .ToProperty()
                .Label($"non-vacuity floor failed: members={specs.Count}, present={presentCount}, "
                    + $"success={result.IsSuccess}, views={result.Value?.Members.Count}");
        }

        IReadOnlyList<SquadMemberView> views = result.Value!.Members;

        // 10.1: the view type declares both decoration fields, and every view is one of the squad's
        // memberships exactly once, so each decoration below is read off the membership it sits on.
        bool carriesBothFields = DeclaresField("Appearances", typeof(int))
            && DeclaresField("RatingState", typeof(RatingState?));
        bool viewsAreTheMemberships = views.Select(v => v.MembershipId).Distinct().Count() == views.Count
            && views.All(v => expected.ContainsKey(v.MembershipId));

        // 10.9 + 10.4 + 10.6: each decoration equals the standing of its own membership; a membership the
        // source does not report reads as zero appearances and no rating state; the rating state is
        // present exactly when that membership has a rating.
        bool joinedCorrectly = views.All(v =>
            v.Appearances == expected[v.MembershipId].Appearances
            && v.RatingState == expected[v.MembershipId].RatingState);

        // 10.5: no view reports a negative appearance count.
        bool appearancesNonNegative = views.All(v => v.Appearances >= 0);

        // 10.7: the decoration is a classification only — never μ, σ, or a display number.
        bool carriesNoRatingArithmetic = CarriesNoRatingArithmeticInputs();

        // 10.2: one squad-scoped standing read, for this squad, whatever the membership count.
        bool readOnceForThisSquad =
            source.CallCount == 1 && source.RequestedSquadIds.SequenceEqual(new[] { squad.Id });

        return (carriesBothFields
                && viewsAreTheMemberships
                && joinedCorrectly
                && appearancesNonNegative
                && carriesNoRatingArithmetic
                && readOnceForThisSquad)
            .ToProperty()
            .Label($"members={specs.Count}, present={presentCount}: fields={carriesBothFields}, "
                + $"identity={viewsAreTheMemberships}, join={joinedCorrectly}, "
                + $"nonNegative={appearancesNonNegative}, noArithmetic={carriesNoRatingArithmetic}, "
                + $"oneRead={readOnceForThisSquad} (calls={source.CallCount})")
            .Collect($"members={specs.Count}");
    }

    /// <summary>
    /// Builds membership <paramref name="index"/>. Index 0 is the reading user's active registered
    /// membership (the read is gated to an active member); the rest vary over guest/registered and
    /// active/inactive, because the decoration must land on every membership the read returns.
    /// </summary>
    private static SquadMembership CreateMembership(
        Guid squadId,
        MemberStandingSpec spec,
        int index,
        Guid readerUserId)
    {
        if (index == 0)
        {
            return SquadMembership.CreateRegistered(squadId, readerUserId, "Reader").Value!;
        }

        SquadMembership membership = spec.Guest
            ? SquadMembership.CreateGuest(squadId, $"Guest{index}", null, DateTimeOffset.UtcNow).Value!
            : SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Member{index}").Value!;

        if (spec.Inactive)
        {
            membership.Deactivate();
        }

        return membership;
    }

    private static bool CarriesMu(RatingShape shape) =>
        shape is RatingShape.MuOnly or RatingShape.Established or RatingShape.Provisional;

    private static bool CarriesSigma(RatingShape shape) =>
        shape is RatingShape.SigmaOnly or RatingShape.Established or RatingShape.Provisional;

    /// <summary>Whether <see cref="SquadMemberView"/> declares a readable field of the given name and type.</summary>
    private static bool DeclaresField(string name, Type type) =>
        typeof(SquadMemberView).GetProperty(name) is PropertyInfo property
        && property.CanRead
        && property.PropertyType == type;

    /// <summary>
    /// Whether the member view is free of rating arithmetic inputs: no μ, no σ, no display rating, and
    /// no floating-point member at all through which one could arrive (Requirement 10.7).
    /// </summary>
    private static bool CarriesNoRatingArithmeticInputs()
    {
        PropertyInfo[] properties = typeof(SquadMemberView).GetProperties();
        string[] forbidden = ["Mu", "Sigma", "DisplayRating"];

        return properties.All(p => !forbidden.Contains(p.Name))
            && properties.All(p => p.PropertyType != typeof(double) && p.PropertyType != typeof(double?));
    }

    /// <summary>What a membership's member view must report.</summary>
    /// <param name="Appearances">The appearance count the view must carry.</param>
    /// <param name="RatingState">The rating state the view must carry, or <see langword="null"/> for none.</param>
    private sealed record StandingExpectation(int Appearances, RatingState? RatingState);
}

/// <summary>
/// One membership in the standing property: whether the standing source reports it, where its
/// appearance count falls inside its own band, which of μ and σ its standing carries, and whether the
/// membership is a guest and/or inactive.
/// </summary>
/// <param name="PresentInStanding">Whether the standing source reports this membership at all.</param>
/// <param name="AppearanceOffset">The offset inside this membership's appearance-count band.</param>
/// <param name="Shape">Which of μ and σ the standing carries, and where σ falls.</param>
/// <param name="Mu">The μ to report when the shape carries one.</param>
/// <param name="Sigma">The σ to report when the shape carries one.</param>
/// <param name="Guest">Whether the membership is a guest (rather than registered).</param>
/// <param name="Inactive">Whether the membership has been deactivated.</param>
public sealed record MemberStandingSpec(
    bool PresentInStanding,
    int AppearanceOffset,
    GetSquadStandingProperties.RatingShape Shape,
    double Mu,
    double Sigma,
    bool Guest,
    bool Inactive);

/// <summary>
/// FsCheck arbitraries for the membership-standing property. Generates a membership set of 2..8, each
/// membership independently present in or absent from the standing result, with a finite μ and a σ
/// either side of the classification threshold, plus the partial (μ-only / σ-only) shapes that are not
/// ratings. Appearance counts are non-negative, matching the counts the source can report; the first
/// membership is normalised to an active, registered, reported one so the read has an active member to
/// serve and the standing subset is never empty.
/// </summary>
public static class MembershipStandingGenerators
{
    private const int MinMembers = 2;
    private const int MaxMembers = 8;
    private const int AppearanceStride = 40;

    /// <summary>Arbitrary for a membership set.</summary>
    public static Arbitrary<IReadOnlyList<MemberStandingSpec>> MemberStandingSpecs() => Arb.From(SpecsGen());

    private static Gen<IReadOnlyList<MemberStandingSpec>> SpecsGen() =>
        from count in Gen.Choose(MinMembers, MaxMembers)
        from specs in Gen.ArrayOf(SpecGen(), count)
        select Normalise(specs);

    private static Gen<MemberStandingSpec> SpecGen() =>
        from present in Gen.Elements(true, false)
        from offset in Gen.Choose(0, AppearanceStride - 1)
        from shape in Gen.Elements(Enum.GetValues<GetSquadStandingProperties.RatingShape>())
        from mu in MuGen()
        from sigma in SigmaGen(shape)
        from guest in Gen.Elements(true, false)
        from inactive in Gen.Elements(true, false)
        select new MemberStandingSpec(present, offset, shape, mu, sigma, guest, inactive);

    /// <summary>A finite μ in [-50, 50]; μ never affects the classification, only σ does.</summary>
    private static Gen<double> MuGen() => Gen.Choose(-5_000, 5_000).Select(hundredths => hundredths / 100.0);

    /// <summary>
    /// A σ in the range the shape demands: at or below the threshold for an established rating, above
    /// it for a provisional one, and anywhere in (0, 9] for the shapes that are not ratings.
    /// </summary>
    private static Gen<double> SigmaGen(GetSquadStandingProperties.RatingShape shape) => shape switch
    {
        GetSquadStandingProperties.RatingShape.Established =>
            Gen.Choose(1, 200).Select(hundredths => hundredths / 100.0),
        GetSquadStandingProperties.RatingShape.Provisional =>
            Gen.Choose(201, 900).Select(hundredths => hundredths / 100.0),
        _ => Gen.Choose(1, 900).Select(hundredths => hundredths / 100.0)
    };

    /// <summary>
    /// Forces the first membership to be an active, registered membership the standing source reports,
    /// so the squad read is authorised and the present subset is non-empty (the property's non-vacuity
    /// floor).
    /// </summary>
    private static IReadOnlyList<MemberStandingSpec> Normalise(MemberStandingSpec[] specs)
    {
        specs[0] = specs[0] with { PresentInStanding = true, Guest = false, Inactive = false };
        return specs;
    }
}
