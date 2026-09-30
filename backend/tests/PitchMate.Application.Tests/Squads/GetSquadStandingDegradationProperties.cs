using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

// PitchMate.Domain.Rating is deliberately not imported: it declares its own Result<T>, which would be
// ambiguous with the squad Result<T> this test reads, and the property needs no rating type by name —
// it only asserts that the rating-state field is absent.

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based test for the degradation contract on the squad read
/// (api-response-contracts Property 19, Requirement 10.8). The standing is a <i>decoration</i> on the
/// membership list, never its precondition: however the
/// <see cref="IMembershipStandingSource"/> fails, the squad read must still succeed and must return
/// exactly the membership list it returns when no standing exists at all, with every member view
/// reading as "nothing to report".
/// <para>
/// Each generated case drives the real <see cref="GetSquadHandler"/> three times over one in-memory
/// squad: once with a failing standing source, once with a source that reports no standing, and once
/// with the standing payload that <i>would</i> have decorated the list. The third read is the
/// non-vacuity floor — it proves the decoration is genuinely there to lose, so the property measures
/// degradation rather than a permanently empty decoration.
/// </para>
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class GetSquadStandingDegradationProperties
{
    /// <summary>The σ threshold the test's rating engine classifies against.</summary>
    private const double ProvisionalThreshold = 2.0;

    /// <summary>The smallest membership set the generator emits (the non-vacuity floor).</summary>
    private const int MinMembers = 2;

    // Feature: api-response-contracts, Property 19: A standing failure degrades the decoration, never
    // the list - for any squad membership set, any standing payload that would have decorated it, and
    // any failure of the standing source (a synchronous throw, a faulted task, a spurious cancellation
    // on an uncancelled request, or a null result), the squad read succeeds and returns the same
    // complete membership list - membership ids, display names, roles, states, guest flags, and order -
    // that it returns when no standing is available at all, with every member view reporting zero
    // appearances and no rating state. The same membership set read with the standing applied carries a
    // non-zero appearance count and a rating state, so the degradation is a real loss.
    // Validates: Requirement 10.8
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(StandingDegradationGenerators) })]
    [Trait("Property", "19")]
    public Property Property19_StandingFailureDegradesTheDecorationNeverTheList(StandingFailureScenario scenario)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Guid readerUserId = Guid.NewGuid();
        var payload = new Dictionary<Guid, MembershipStanding>();

        for (int i = 0; i < scenario.Members.Count; i++)
        {
            DegradationMemberSpec spec = scenario.Members[i];
            SquadMembership membership = CreateMembership(squad.Id, spec, i, readerUserId);
            store.AddCommittedMembership(membership);

            if (spec.PresentInStanding)
            {
                payload[membership.Id] = new MembershipStanding(
                    1 + spec.AppearanceOffset,
                    spec.CarriesRating ? spec.Mu : null,
                    spec.CarriesRating ? spec.Sigma : null);
            }
        }

        // The failing read: the source reports the failure this case selected.
        var failing = new FakeMembershipStandingSource().WithStanding(squad.Id, payload);
        ApplyFailure(failing, scenario.Failure);
        Result<SquadData> failed = Read(store, squad.Id, readerUserId, failing);

        // The baseline read: an identical squad whose standing source simply has nothing to report.
        var empty = new FakeMembershipStandingSource();
        Result<SquadData> baseline = Read(store, squad.Id, readerUserId, empty);

        // The decorated read: the same squad with the payload actually applied — the non-vacuity floor.
        var decorating = new FakeMembershipStandingSource().WithStanding(squad.Id, payload);
        Result<SquadData> decorated = Read(store, squad.Id, readerUserId, decorating);

        // Non-vacuity floor: all three reads must have succeeded over a real membership set, the failing
        // source must actually have been consulted (so the failure path was exercised rather than
        // skipped), and the decorated read must carry standing to lose — at least one non-zero
        // appearance count and at least one rating state. Without the last conjunct a handler that never
        // decorated anything would satisfy every assertion below.
        bool decorationIsReal =
            decorated.IsSuccess
            && decorated.Value!.Members.Any(m => m.Appearances > 0)
            && decorated.Value!.Members.Any(m => m.RatingState is not null);

        bool floorHolds =
            scenario.Members.Count >= MinMembers
            && failed.IsSuccess
            && baseline.IsSuccess
            && baseline.Value!.Members.Count == scenario.Members.Count
            && failing.CallCount == 1
            && decorationIsReal;

        if (!floorHolds)
        {
            return false
                .ToProperty()
                .Label($"non-vacuity floor failed: failure={scenario.Failure}, "
                    + $"members={scenario.Members.Count}, failedRead={failed.IsSuccess}, "
                    + $"baselineRead={baseline.IsSuccess}, baselineViews={baseline.Value?.Members.Count}, "
                    + $"sourceCalls={failing.CallCount}, decorationIsReal={decorationIsReal}");
        }

        IReadOnlyList<SquadMemberView> views = failed.Value!.Members;

        // 10.8 (the list): the failing read returns the same squad and the same complete membership
        // list, element for element and in the same order, as the read that had no standing to report.
        bool sameSquad = failed.Value!.SquadId == baseline.Value!.SquadId
            && failed.Value!.Name == baseline.Value!.Name;
        bool sameMembershipList = SameMemberships(views, baseline.Value!.Members);

        // 10.8 (the decoration): every member view degrades to "nothing to report" — which is exactly
        // the shape of a membership the source does not mention.
        bool everyViewIsUndecorated = views.All(v => v.Appearances == 0 && v.RatingState is null);
        bool baselineIsUndecorated = baseline.Value!.Members.All(v => v.Appearances == 0 && v.RatingState is null);

        return (sameSquad && sameMembershipList && everyViewIsUndecorated && baselineIsUndecorated)
            .ToProperty()
            .Label($"failure={scenario.Failure}, members={scenario.Members.Count}: sameSquad={sameSquad}, "
                + $"sameList={sameMembershipList}, degraded={everyViewIsUndecorated}, "
                + $"baselineUndecorated={baselineIsUndecorated}")
            .Collect($"failure={scenario.Failure}, members={scenario.Members.Count}");
    }

    /// <summary>Runs the real squad read over the seeded store with the given standing source.</summary>
    private static Result<SquadData> Read(
        SquadStore store,
        Guid squadId,
        Guid readerUserId,
        IMembershipStandingSource standing) =>
        new GetSquadHandler(
                new FakeSquadRepository(store),
                new FakeSquadMembershipRepository(store),
                standing,
                new SquadThresholdRatingEngine(ProvisionalThreshold))
            .HandleAsync(new GetSquadCommand(readerUserId, squadId), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

    /// <summary>Configures the source to fail in the way this case selected.</summary>
    private static void ApplyFailure(FakeMembershipStandingSource source, StandingFailureKind failure)
    {
        switch (failure)
        {
            case StandingFailureKind.ThrowsInvalidOperation:
                source.Failure = new InvalidOperationException("the standing query failed");
                break;
            case StandingFailureKind.ThrowsTimeout:
                source.Failure = new TimeoutException("the standing query timed out");
                break;
            case StandingFailureKind.ThrowsSpuriousCancellation:
                // The request itself was never cancelled, so this is a source failure, not a caller
                // cancellation: it must degrade like any other.
                source.Failure = new OperationCanceledException("the standing query was cancelled");
                break;
            case StandingFailureKind.FaultedTaskInvalidOperation:
                source.Failure = new InvalidOperationException("the standing query failed asynchronously");
                source.Delivery = FakeMembershipStandingSource.FailureDelivery.FaultedTask;
                break;
            case StandingFailureKind.FaultedTaskTimeout:
                source.Failure = new TimeoutException("the standing query timed out asynchronously");
                source.Delivery = FakeMembershipStandingSource.FailureDelivery.FaultedTask;
                break;
            case StandingFailureKind.FaultedTaskSpuriousCancellation:
                source.Failure = new OperationCanceledException("the standing query was cancelled asynchronously");
                source.Delivery = FakeMembershipStandingSource.FailureDelivery.FaultedTask;
                break;
            case StandingFailureKind.ReturnsNull:
                source.ReturnsNull = true;
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(failure), failure, "Unhandled failure mode.");
        }
    }

    /// <summary>
    /// Whether two member lists describe the same memberships in the same order: identity, display
    /// name, role, lifecycle state, and guest flag. The standing fields are deliberately excluded —
    /// they are what the failure is allowed to change.
    /// </summary>
    private static bool SameMemberships(
        IReadOnlyList<SquadMemberView> left,
        IReadOnlyList<SquadMemberView> right) =>
        left.Count == right.Count
        && left.Zip(right).All(pair =>
            pair.First.MembershipId == pair.Second.MembershipId
            && pair.First.DisplayName == pair.Second.DisplayName
            && pair.First.Role == pair.Second.Role
            && pair.First.State == pair.Second.State
            && pair.First.IsGuest == pair.Second.IsGuest);

    /// <summary>
    /// Builds membership <paramref name="index"/>. Index 0 is the reading user's active registered
    /// membership (the read is gated to an active member); the rest vary over guest/registered and
    /// active/inactive, because the whole list must survive the failure, not just its active part.
    /// </summary>
    private static SquadMembership CreateMembership(
        Guid squadId,
        DegradationMemberSpec spec,
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
}

/// <summary>How the standing source fails: what it raises, and whether it raises it synchronously, as
/// a faulted task, or not at all (answering a null dictionary instead).</summary>
public enum StandingFailureKind
{
    /// <summary>Throws an <see cref="InvalidOperationException"/> before returning a task.</summary>
    ThrowsInvalidOperation,

    /// <summary>Throws a <see cref="TimeoutException"/> before returning a task.</summary>
    ThrowsTimeout,

    /// <summary>Throws an <see cref="OperationCanceledException"/> although the request was not cancelled.</summary>
    ThrowsSpuriousCancellation,

    /// <summary>Returns a task faulted with an <see cref="InvalidOperationException"/>.</summary>
    FaultedTaskInvalidOperation,

    /// <summary>Returns a task faulted with a <see cref="TimeoutException"/>.</summary>
    FaultedTaskTimeout,

    /// <summary>Returns a task faulted with an <see cref="OperationCanceledException"/>, uncancelled request.</summary>
    FaultedTaskSpuriousCancellation,

    /// <summary>Answers a null dictionary — a contract violation rather than an exception.</summary>
    ReturnsNull
}

/// <summary>
/// One membership in the degradation property: the standing it would have been decorated with, and the
/// kind of membership it is.
/// </summary>
/// <param name="PresentInStanding">Whether the standing payload mentions this membership.</param>
/// <param name="AppearanceOffset">Offset added to 1 for this membership's appearance count.</param>
/// <param name="CarriesRating">Whether that standing carries both μ and σ (so it is a rating).</param>
/// <param name="Mu">The μ the standing carries when it carries a rating.</param>
/// <param name="Sigma">The σ the standing carries when it carries a rating.</param>
/// <param name="Guest">Whether the membership is a guest (rather than registered).</param>
/// <param name="Inactive">Whether the membership has been deactivated.</param>
public sealed record DegradationMemberSpec(
    bool PresentInStanding,
    int AppearanceOffset,
    bool CarriesRating,
    double Mu,
    double Sigma,
    bool Guest,
    bool Inactive);

/// <summary>
/// One generated case: how the standing source fails, and the membership set (with the standing payload
/// it would have been decorated with) that must survive the failure intact.
/// </summary>
/// <param name="Failure">The failure the standing source reports.</param>
/// <param name="Members">One spec per membership, in membership order.</param>
public sealed record StandingFailureScenario(
    StandingFailureKind Failure,
    IReadOnlyList<DegradationMemberSpec> Members);

/// <summary>
/// FsCheck arbitraries for the degradation property. Every failure mode is drawn uniformly, over
/// membership sets of 2..8 mixing guests with registered members and active with inactive memberships,
/// each independently present in or absent from the standing payload. The first membership is
/// normalised to the reading user's active registered membership and is always present in the payload
/// with a non-zero appearance count and a classifiable rating, so the read is authorised and the
/// decorated control read has standing to lose.
/// </summary>
public static class StandingDegradationGenerators
{
    private const int MinMembers = 2;
    private const int MaxMembers = 8;

    /// <summary>Arbitrary for a degradation scenario.</summary>
    public static Arbitrary<StandingFailureScenario> Scenarios() => Arb.From(ScenarioGen());

    private static Gen<StandingFailureScenario> ScenarioGen() =>
        from failure in Gen.Elements(Enum.GetValues<StandingFailureKind>())
        from count in Gen.Choose(MinMembers, MaxMembers)
        from members in Gen.ArrayOf(MemberGen(), count)
        select new StandingFailureScenario(failure, Normalise(members));

    private static Gen<DegradationMemberSpec> MemberGen() =>
        from present in Gen.Elements(true, false)
        from offset in Gen.Choose(0, 99)
        from carriesRating in Gen.Elements(true, false)
        from mu in MuGen()
        from sigma in SigmaGen()
        from guest in Gen.Elements(true, false)
        from inactive in Gen.Elements(true, false)
        select new DegradationMemberSpec(present, offset, carriesRating, mu, sigma, guest, inactive);

    /// <summary>A finite μ in [-50, 50]; μ never affects the classification, only σ does.</summary>
    private static Gen<double> MuGen() => Gen.Choose(-5_000, 5_000).Select(hundredths => hundredths / 100.0);

    /// <summary>A finite σ in (0, 9], spanning both sides of the test engine's threshold.</summary>
    private static Gen<double> SigmaGen() => Gen.Choose(1, 900).Select(hundredths => hundredths / 100.0);

    /// <summary>
    /// Forces the first membership to be an active, registered membership with a real standing, so the
    /// squad read is authorised and the decorated control read carries both a non-zero appearance count
    /// and a rating state (the property's non-vacuity floor).
    /// </summary>
    private static IReadOnlyList<DegradationMemberSpec> Normalise(DegradationMemberSpec[] members)
    {
        members[0] = members[0] with
        {
            PresentInStanding = true,
            CarriesRating = true,
            Guest = false,
            Inactive = false
        };

        return members;
    }
}
