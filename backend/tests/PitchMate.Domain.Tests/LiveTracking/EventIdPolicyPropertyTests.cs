using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;
using Result = PitchMate.Domain.LiveTracking.Result;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based tests for <see cref="EventIdPolicy.Validate"/> (live-tracking design Property 2).
/// The <c>Event_Id</c> policy accepts an id if and only if it is non-empty and a UUID version 7,
/// rejecting <see cref="Guid.Empty"/> and any non-version-7 id with a validation failure that
/// identifies the policy. The generator deliberately spans <see cref="Guid.Empty"/>, freshly-minted
/// UUID version 7 values, and arbitrary (random-version) GUIDs, running at least 100 iterations.
/// </summary>
[Trait("Feature", "live-tracking")]
public class EventIdPolicyPropertyTests
{
    // Feature: live-tracking, Property 2: Event_Id policy is enforced
    // EventIdPolicy.Validate(id) succeeds exactly when id is non-empty AND id.Version == 7;
    // otherwise it fails with a ValidationFailed error identifying the Event_Id policy.
    // Validates: Requirements 1.4
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property EventIdIsAcceptedExactlyWhenNonEmptyVersion7() =>
        Prop.ForAll(Arb.From(CandidateEventIdGen()), eventId =>
        {
            bool expectedValid = eventId != Guid.Empty && eventId.Version == 7;

            Result result = EventIdPolicy.Validate(eventId);

            if (expectedValid)
            {
                return result.IsSuccess && result.Error is null;
            }

            return !result.IsSuccess
                && result.Error is { Code: LiveTrackingErrorCode.ValidationFailed };
        });

    /// <summary>
    /// Generates a candidate <c>Event_Id</c>: the all-zero <see cref="Guid.Empty"/>, a freshly
    /// generated UUID version 7, or an arbitrary (random-version) GUID built from four random words.
    /// </summary>
    private static Gen<Guid> CandidateEventIdGen() =>
        Gen.OneOf(
            Gen.Constant(Guid.Empty),
            Gen.Constant(0).Select(_ => Guid.CreateVersion7()),
            ArbitraryGuidGen());

    private static Gen<Guid> ArbitraryGuidGen() =>
        from a in Gen.Choose(int.MinValue, int.MaxValue)
        from b in Gen.Choose(int.MinValue, int.MaxValue)
        from c in Gen.Choose(int.MinValue, int.MaxValue)
        from d in Gen.Choose(int.MinValue, int.MaxValue)
        select GuidFromInts(a, b, c, d);

    private static Guid GuidFromInts(int a, int b, int c, int d)
    {
        var bytes = new byte[16];
        BitConverter.GetBytes(a).CopyTo(bytes, 0);
        BitConverter.GetBytes(b).CopyTo(bytes, 4);
        BitConverter.GetBytes(c).CopyTo(bytes, 8);
        BitConverter.GetBytes(d).CopyTo(bytes, 12);
        return new Guid(bytes);
    }
}
