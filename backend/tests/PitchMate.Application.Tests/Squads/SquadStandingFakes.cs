using PitchMate.Application.Squads.Abstractions;
// PitchMate.Domain.Squads (imported by the squad fakes) and PitchMate.Domain.Rating both define a
// Result<T>; alias the specific rating types these doubles need and fully qualify the engine's own
// Result<T> in its signatures, so the two triads are never confused.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using MatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using MatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using RatingError = PitchMate.Domain.Rating.RatingError;
using RatingErrorCode = PitchMate.Domain.Rating.RatingErrorCode;
using RatingState = PitchMate.Domain.Rating.RatingState;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// A hand-written <see cref="IMembershipStandingSource"/> for the squad read tests. It answers from a
/// dictionary the test seeds, counts its invocations — so a test can assert the squad read makes
/// exactly one squad-scoped call whatever the squad's size — and can be told to fail, so the
/// degradation path is exercised without a mocking framework.
/// </summary>
internal sealed class FakeMembershipStandingSource : IMembershipStandingSource
{
    private readonly Dictionary<Guid, IReadOnlyDictionary<Guid, MembershipStanding>> _bySquad = new();

    /// <summary>How a set <see cref="Failure"/> reaches the caller.</summary>
    internal enum FailureDelivery
    {
        /// <summary>The exception is thrown before a task is returned — a synchronous failure.</summary>
        SynchronousThrow,

        /// <summary>A faulted task is returned, so the exception surfaces at the <c>await</c>.</summary>
        FaultedTask
    }

    /// <summary>The number of times <see cref="ListForSquadAsync"/> was invoked.</summary>
    public int CallCount { get; private set; }

    /// <summary>The squad identities the source was asked about, in order.</summary>
    public List<Guid> RequestedSquadIds { get; } = [];

    /// <summary>When set, the source fails on every call instead of answering.</summary>
    public Exception? Failure { get; set; }

    /// <summary>
    /// How a set <see cref="Failure"/> is delivered. Defaults to a synchronous throw; a real
    /// implementation awaiting a database can fail either way, and the consumer must survive both.
    /// </summary>
    public FailureDelivery Delivery { get; set; } = FailureDelivery.SynchronousThrow;

    /// <summary>
    /// When set, the source answers a <see langword="null"/> dictionary — a contract violation rather
    /// than an exception, which the consumer must also survive.
    /// </summary>
    public bool ReturnsNull { get; set; }

    /// <summary>Seeds the standing the source reports for <paramref name="squadId"/>.</summary>
    public FakeMembershipStandingSource WithStanding(
        Guid squadId,
        IReadOnlyDictionary<Guid, MembershipStanding> standing)
    {
        _bySquad[squadId] = standing;
        return this;
    }

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<Guid, MembershipStanding>> ListForSquadAsync(
        Guid squadId,
        CancellationToken cancellationToken)
    {
        CallCount++;
        RequestedSquadIds.Add(squadId);

        if (Failure is not null)
        {
            if (Delivery == FailureDelivery.FaultedTask)
            {
                return Task.FromException<IReadOnlyDictionary<Guid, MembershipStanding>>(Failure);
            }

            throw Failure;
        }

        if (ReturnsNull)
        {
            // Deliberately violates the interface's non-nullable return so the consumer's handling of a
            // misbehaving implementation is exercised; null! is the point of this branch.
            return Task.FromResult<IReadOnlyDictionary<Guid, MembershipStanding>>(null!);
        }

        return Task.FromResult(_bySquad.TryGetValue(squadId, out IReadOnlyDictionary<Guid, MembershipStanding>? standing)
            ? standing
            : new Dictionary<Guid, MembershipStanding>());
    }
}

/// <summary>
/// A deterministic <see cref="IRatingEngine"/> for the squad read tests, mirroring the stats tests'
/// threshold engine: <see cref="GetState"/> reports <see cref="RatingState.Established"/> when σ is at
/// or below a fixed threshold and <see cref="RatingState.Provisional"/> otherwise, and reports a
/// failure for a non-finite σ so the handler's degradation on an unclassifiable rating can be
/// exercised. Every other operation is unused by the squad read and throws if called.
/// </summary>
internal sealed class SquadThresholdRatingEngine(double provisionalThreshold = 2.0) : IRatingEngine
{
    /// <summary>The σ threshold at or below which a rating is established.</summary>
    public double ProvisionalThreshold { get; } = provisionalThreshold;

    /// <summary>The number of times <see cref="GetState"/> was invoked.</summary>
    public int GetStateCallCount { get; private set; }

    public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating)
    {
        GetStateCallCount++;

        if (!double.IsFinite(rating.Mu) || !double.IsFinite(rating.Sigma))
        {
            return PitchMate.Domain.Rating.Result<RatingState>.Fail(
                new RatingError(RatingErrorCode.NonFiniteValue, "A rating must be finite."));
        }

        return PitchMate.Domain.Rating.Result<RatingState>.Ok(
            rating.Sigma <= ProvisionalThreshold ? RatingState.Established : RatingState.Provisional);
    }

    public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
        throw new NotSupportedException("Not exercised by the squad read under test.");

    public PitchMate.Domain.Rating.Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) =>
        throw new NotSupportedException("Not exercised by the squad read under test.");

    public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
        IReadOnlyList<PlayerRating> initialRatings,
        IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException("Not exercised by the squad read under test.");

    public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
        throw new NotSupportedException("Not exercised by the squad read under test.");

    public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
        throw new NotSupportedException("Not exercised by the squad read under test.");
}
