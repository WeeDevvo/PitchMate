using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Tests.Squads;
using PitchMate.Domain.Matches;
using MatchResultTriad = PitchMate.Domain.Matches.Result;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for the squad-mismatch refusal the six path-corrected operations gained in task 2.2 —
/// <see cref="SubmitAvailabilityResponseHandler"/>, <see cref="ClearAvailabilityResponseHandler"/>,
/// <see cref="GetAvailabilityTallyHandler"/>, <see cref="ConfirmMatchHandler"/>,
/// <see cref="AddGuestParticipantHandler"/> and <see cref="RemoveParticipantHandler"/>
/// (Requirements 7.4, 7.6).
/// <para>
/// Each operation gets a matched pair of tests over the same fixture. The <em>mismatch</em> test
/// supplies a <c>SquadId</c> that is not the squad the match records and asserts three things
/// together: the operation returns that handler's own existing uniform authorisation failure
/// (<see cref="MatchErrorCode.Unauthorized"/>, no new error code), the membership repository is
/// never called at all — which is what makes Requirement 7.6 literally true, since a squad id that
/// never reaches the gate cannot be an input to its decision — and nothing is written, neither
/// through the unit of work nor onto the loaded aggregate. The <em>matching</em> test supplies the
/// match's own squad and asserts the operation reaches its normal path, so the refusal is shown to
/// be the mismatch's doing rather than a fixture that could never have succeeded.
/// </para>
/// <para>
/// Every handler is driven against hand-written in-memory fakes with no database and no
/// <c>DbContext</c>, per the Application-layer testing strategy. The gates themselves are not
/// re-tested here — <see cref="AvailabilityAuthorisationPropertyTests"/> and
/// <see cref="OrganiserAuthorisationPropertyTests"/> own who may act — so every fixture seeds an
/// actor the gate would admit, leaving the squad mismatch as the only thing under test.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class SquadMismatchRefusalTests
{
    /// <summary>A fixed UTC anchor the fake clock reads from; every candidate day sits after it.</summary>
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The candidate days every fixture's match is drafted with, already strictly future.</summary>
    private static readonly DateTimeOffset[] CandidateDays = [Now.AddDays(7), Now.AddDays(8)];

    private const string Location = "Hackney Marshes, Pitch 12";

    // ---------------------------------------------------------------------------------------------
    // SubmitAvailabilityResponse
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A submission whose path squad is not the match's squad is refused with the handler's uniform
    /// authorisation failure before the acting membership is resolved, and stores nothing
    /// (Requirements 7.4, 7.6).
    /// </summary>
    [Fact]
    public async Task SubmitAvailability_MismatchedSquad_RefusedUniformlyWithoutResolvingMembershipOrWriting()
    {
        AvailabilityFixture f = AvailabilityFixture.Create();

        Result<SubmitAvailabilityResult> result = await f.SubmitHandler.HandleAsync(
            new SubmitAvailabilityResponseCommand(
                f.ActingUserId, OtherSquadId(f.SquadId), f.MatchId, [CandidateDays[0]]),
            CancellationToken.None);

        AssertUniformAuthorisationFailure(result.IsSuccess, result.Error);
        f.AssertNoMembershipResolution();
        f.AssertNothingWritten();
        Assert.Empty(f.Match.AvailabilityResponses);
    }

    /// <summary>
    /// The same submission carrying the match's own squad reaches the operation's normal path and
    /// stores the response (Requirement 7.4).
    /// </summary>
    [Fact]
    public async Task SubmitAvailability_MatchingSquad_ReachesTheNormalPath()
    {
        AvailabilityFixture f = AvailabilityFixture.Create();

        Result<SubmitAvailabilityResult> result = await f.SubmitHandler.HandleAsync(
            new SubmitAvailabilityResponseCommand(
                f.ActingUserId, f.SquadId, f.MatchId, [CandidateDays[0]]),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(f.ActingMembershipId, result.Value!.SquadMembershipId);
        Assert.Equal(1, f.Memberships.ResolutionCallCount);
        Assert.Equal(1, f.UnitOfWork.SaveCallCount);
        Assert.Equal(1, f.Availability.StoredResponseCount);
    }

    // ---------------------------------------------------------------------------------------------
    // ClearAvailabilityResponse
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A clear whose path squad is not the match's squad is refused with the handler's uniform
    /// authorisation failure before the acting membership is resolved, and leaves the stored
    /// response in place (Requirements 7.4, 7.6).
    /// </summary>
    [Fact]
    public async Task ClearAvailability_MismatchedSquad_RefusedUniformlyWithoutResolvingMembershipOrWriting()
    {
        AvailabilityFixture f = AvailabilityFixture.CreateWithStoredResponse();

        MatchResultTriad result = await f.ClearHandler.HandleAsync(
            new ClearAvailabilityResponseCommand(f.ActingUserId, OtherSquadId(f.SquadId), f.MatchId),
            CancellationToken.None);

        AssertUniformAuthorisationFailure(result.IsSuccess, result.Error);
        f.AssertNoMembershipResolution();
        f.AssertNothingWritten();
        Assert.Equal(1, f.Availability.StoredResponseCount);
    }

    /// <summary>
    /// The same clear carrying the match's own squad reaches the operation's normal path and removes
    /// the stored response (Requirement 7.4).
    /// </summary>
    [Fact]
    public async Task ClearAvailability_MatchingSquad_ReachesTheNormalPath()
    {
        AvailabilityFixture f = AvailabilityFixture.CreateWithStoredResponse();

        MatchResultTriad result = await f.ClearHandler.HandleAsync(
            new ClearAvailabilityResponseCommand(f.ActingUserId, f.SquadId, f.MatchId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, f.Memberships.ResolutionCallCount);
        Assert.Equal(1, f.UnitOfWork.SaveCallCount);
        Assert.Equal(0, f.Availability.StoredResponseCount);
    }

    // ---------------------------------------------------------------------------------------------
    // GetAvailabilityTally
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A tally read whose path squad is not the match's squad is refused with the handler's uniform
    /// authorisation failure — the one the endpoint conceals as a not-found — before the requesting
    /// membership is resolved, and never reads the stored responses (Requirements 7.4, 7.6).
    /// </summary>
    [Fact]
    public async Task GetAvailabilityTally_MismatchedSquad_RefusedUniformlyWithoutResolvingMembershipOrReading()
    {
        AvailabilityFixture f = AvailabilityFixture.CreateWithStoredResponse();

        Result<AvailabilityTally> result = await f.TallyHandler.HandleAsync(
            new GetAvailabilityTallyCommand(f.ActingUserId, OtherSquadId(f.SquadId), f.MatchId),
            CancellationToken.None);

        AssertUniformAuthorisationFailure(result.IsSuccess, result.Error);
        f.AssertNoMembershipResolution();
        f.AssertNothingWritten();
        Assert.Equal(0, f.Availability.ListCallCount);
    }

    /// <summary>
    /// The same tally read carrying the match's own squad reaches the operation's normal path and
    /// reports every candidate day (Requirement 7.4).
    /// </summary>
    [Fact]
    public async Task GetAvailabilityTally_MatchingSquad_ReachesTheNormalPath()
    {
        AvailabilityFixture f = AvailabilityFixture.CreateWithStoredResponse();

        Result<AvailabilityTally> result = await f.TallyHandler.HandleAsync(
            new GetAvailabilityTallyCommand(f.ActingUserId, f.SquadId, f.MatchId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(CandidateDays.Length, result.Value!.Days.Count);
        Assert.Equal(1, f.Memberships.ResolutionCallCount);
        Assert.Equal(1, f.Availability.ListCallCount);
    }

    // ---------------------------------------------------------------------------------------------
    // ConfirmMatch
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A confirmation whose path squad is not the match's squad is refused with the handler's uniform
    /// authorisation failure before the acting membership is resolved, leaving the match gathering
    /// availability with no confirmed day, no participants, and no notification raised
    /// (Requirements 7.4, 7.6).
    /// </summary>
    [Fact]
    public async Task ConfirmMatch_MismatchedSquad_RefusedUniformlyWithoutResolvingMembershipOrWriting()
    {
        ConfirmFixture f = ConfirmFixture.Create();

        Result<ConfirmMatchResult> result = await f.Handler.HandleAsync(
            new ConfirmMatchCommand(
                f.OwnerUserId, OtherSquadId(f.SquadId), f.MatchId, CandidateDays[0]),
            CancellationToken.None);

        AssertUniformAuthorisationFailure(result.IsSuccess, result.Error);
        Assert.Equal(0, f.Memberships.CallCount);
        Assert.Equal(0, f.UnitOfWork.SaveCallCount);
        Assert.Equal(MatchState.GatheringAvailability, f.Match.State);
        Assert.Null(f.Match.ConfirmedDay);
        Assert.Empty(f.Match.Participants);
        Assert.Empty(f.Publisher.Calls);
    }

    /// <summary>
    /// The same confirmation carrying the match's own squad reaches the operation's normal path and
    /// confirms the match (Requirement 7.4).
    /// </summary>
    [Fact]
    public async Task ConfirmMatch_MatchingSquad_ReachesTheNormalPath()
    {
        ConfirmFixture f = ConfirmFixture.Create();

        Result<ConfirmMatchResult> result = await f.Handler.HandleAsync(
            new ConfirmMatchCommand(f.OwnerUserId, f.SquadId, f.MatchId, CandidateDays[0]),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(MatchState.Confirmed, f.Match.State);
        Assert.Equal(1, f.Memberships.ResolutionCallCount);
        Assert.Equal(1, f.UnitOfWork.SaveCallCount);
    }

    // ---------------------------------------------------------------------------------------------
    // AddGuestParticipant
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A guest addition whose path squad is not the match's squad is refused with the handler's
    /// uniform authorisation failure before the acting membership is resolved, and adds no
    /// participant (Requirements 7.4, 7.6).
    /// </summary>
    [Fact]
    public async Task AddGuestParticipant_MismatchedSquad_RefusedUniformlyWithoutResolvingMembershipOrWriting()
    {
        ParticipantFixture f = ParticipantFixture.Create(seedGuestAsParticipant: false);

        Result<AddGuestParticipantResult> result = await f.AddHandler.HandleAsync(
            new AddGuestParticipantCommand(
                f.OwnerUserId, OtherSquadId(f.SquadId), f.MatchId, f.GuestMembershipId),
            CancellationToken.None);

        AssertUniformAuthorisationFailure(result.IsSuccess, result.Error);
        Assert.Equal(0, f.Memberships.CallCount);
        Assert.Equal(0, f.UnitOfWork.SaveCallCount);
        Assert.Empty(f.Match.Participants);
    }

    /// <summary>
    /// The same guest addition carrying the match's own squad reaches the operation's normal path and
    /// adds the guest as a participant (Requirement 7.4).
    /// </summary>
    [Fact]
    public async Task AddGuestParticipant_MatchingSquad_ReachesTheNormalPath()
    {
        ParticipantFixture f = ParticipantFixture.Create(seedGuestAsParticipant: false);

        Result<AddGuestParticipantResult> result = await f.AddHandler.HandleAsync(
            new AddGuestParticipantCommand(f.OwnerUserId, f.SquadId, f.MatchId, f.GuestMembershipId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, f.Memberships.ResolutionCallCount);
        Assert.Equal(1, f.UnitOfWork.SaveCallCount);
        MatchParticipant participant = Assert.Single(f.Match.Participants);
        Assert.Equal(f.GuestMembershipId, participant.SquadMembershipId);
    }

    // ---------------------------------------------------------------------------------------------
    // RemoveParticipant
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A participant removal whose path squad is not the match's squad is refused with the handler's
    /// uniform authorisation failure before the acting membership is resolved, and removes no
    /// participant (Requirements 7.4, 7.6).
    /// </summary>
    [Fact]
    public async Task RemoveParticipant_MismatchedSquad_RefusedUniformlyWithoutResolvingMembershipOrWriting()
    {
        ParticipantFixture f = ParticipantFixture.Create(seedGuestAsParticipant: true);

        MatchResultTriad result = await f.RemoveHandler.HandleAsync(
            new RemoveParticipantCommand(
                f.OwnerUserId, OtherSquadId(f.SquadId), f.MatchId, f.GuestMembershipId),
            CancellationToken.None);

        AssertUniformAuthorisationFailure(result.IsSuccess, result.Error);
        Assert.Equal(0, f.Memberships.CallCount);
        Assert.Equal(0, f.UnitOfWork.SaveCallCount);
        Assert.Single(f.Match.Participants);
    }

    /// <summary>
    /// The same removal carrying the match's own squad reaches the operation's normal path and removes
    /// the participant (Requirement 7.4).
    /// </summary>
    [Fact]
    public async Task RemoveParticipant_MatchingSquad_ReachesTheNormalPath()
    {
        ParticipantFixture f = ParticipantFixture.Create(seedGuestAsParticipant: true);

        MatchResultTriad result = await f.RemoveHandler.HandleAsync(
            new RemoveParticipantCommand(f.OwnerUserId, f.SquadId, f.MatchId, f.GuestMembershipId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, f.Memberships.ResolutionCallCount);
        Assert.Equal(1, f.UnitOfWork.SaveCallCount);
        Assert.Empty(f.Match.Participants);
    }

    // ---------------------------------------------------------------------------------------------
    // Shared assertions and fixtures
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A squad identity that is deterministically not <paramref name="matchSquadId"/>, standing for the
    /// squad named in a request path that is not the squad the match records.
    /// </summary>
    private static Guid OtherSquadId(Guid matchSquadId)
    {
        Guid other = Guid.NewGuid();
        Assert.NotEqual(matchSquadId, other);
        return other;
    }

    /// <summary>
    /// Asserts a handler reported the single uniform authorisation failure every one of the six
    /// already returns for a caller it will not serve — the same <see cref="MatchErrorCode"/> and the
    /// same non-disclosing message, so the mismatch adds no new error code and no new message a
    /// caller could distinguish (Requirement 7.4).
    /// </summary>
    private static void AssertUniformAuthorisationFailure(bool isSuccess, MatchError? error)
    {
        Assert.False(isSuccess);
        Assert.NotNull(error);
        Assert.Equal(MatchErrorCode.Unauthorized, error!.Code);
        Assert.Equal("The requested action is not permitted.", error.Message);
    }

    /// <summary>
    /// Assembles the three availability operations over one match in
    /// <see cref="MatchState.GatheringAvailability"/> whose squad holds a single active registered
    /// member, so each gate would admit the actor and the squad mismatch is the only thing under test.
    /// </summary>
    private sealed class AvailabilityFixture
    {
        private AvailabilityFixture(
            Match match,
            CallCountingMembershipRepository memberships,
            TrackingAvailabilityRepository availability,
            ConfirmFakeUnitOfWork unitOfWork,
            Guid actingUserId,
            Guid actingMembershipId)
        {
            Match = match;
            Memberships = memberships;
            Availability = availability;
            UnitOfWork = unitOfWork;
            ActingUserId = actingUserId;
            ActingMembershipId = actingMembershipId;

            var matches = new ConcealmentMatchRepository(match);
            var clock = new FakeTimeProvider(Now);

            SubmitHandler = new SubmitAvailabilityResponseHandler(
                matches, memberships, availability, unitOfWork, clock);
            ClearHandler = new ClearAvailabilityResponseHandler(
                matches, memberships, availability, unitOfWork);
            TallyHandler = new GetAvailabilityTallyHandler(matches, memberships, availability);
        }

        public SubmitAvailabilityResponseHandler SubmitHandler { get; }

        public ClearAvailabilityResponseHandler ClearHandler { get; }

        public GetAvailabilityTallyHandler TallyHandler { get; }

        public Match Match { get; }

        public CallCountingMembershipRepository Memberships { get; }

        public TrackingAvailabilityRepository Availability { get; }

        public ConfirmFakeUnitOfWork UnitOfWork { get; }

        public Guid ActingUserId { get; }

        public Guid ActingMembershipId { get; }

        /// <summary>The match's own squad — the only squad a request path may name for this match.</summary>
        public Guid SquadId => Match.SquadId;

        public Guid MatchId => Match.Id;

        public static AvailabilityFixture Create() => Build(withStoredResponse: false);

        /// <summary>
        /// The same fixture with the acting member's availability already submitted and stored, so a
        /// clear has something to remove and a tally something to count.
        /// </summary>
        public static AvailabilityFixture CreateWithStoredResponse() => Build(withStoredResponse: true);

        private static AvailabilityFixture Build(bool withStoredResponse)
        {
            var squadId = Guid.NewGuid();
            var actingUserId = Guid.NewGuid();

            Match match = Match.CreateDraft(
                Guid.CreateVersion7(), squadId, Location, CandidateDays, Now).Value!;

            SquadMembership acting =
                SquadMembership.CreateRegistered(squadId, actingUserId, "Member").Value!;

            var availability = new TrackingAvailabilityRepository();
            if (withStoredResponse)
            {
                // Produced by the aggregate so the stored response is exactly what a real submission
                // would have persisted, then seeded directly rather than through the write path so the
                // repository's write counter starts at zero.
                AvailabilityResponse seeded =
                    match.SubmitAvailability(acting.Id, [CandidateDays[0]], Now).Value!;
                availability.Seed(seeded);
            }

            return new AvailabilityFixture(
                match,
                new CallCountingMembershipRepository(new ConcealmentMembershipRepository(acting)),
                availability,
                new ConfirmFakeUnitOfWork(),
                actingUserId,
                acting.Id);
        }

        /// <summary>
        /// Asserts the membership repository was never touched, so the path squad cannot have been an
        /// input to the gate's decision (Requirement 7.6).
        /// </summary>
        public void AssertNoMembershipResolution() => Assert.Equal(0, Memberships.CallCount);

        /// <summary>Asserts no write was attempted, through the unit of work or the repository.</summary>
        public void AssertNothingWritten()
        {
            Assert.Equal(0, UnitOfWork.SaveCallCount);
            Assert.Equal(0, Availability.WriteCallCount);
        }
    }

    /// <summary>
    /// Assembles <see cref="ConfirmMatchHandler"/> over a squad holding an acting owner and ten active
    /// registered members who each marked the day, so the default threshold of 10 is met and the
    /// squad mismatch is the only thing that can refuse the confirmation.
    /// </summary>
    private sealed class ConfirmFixture
    {
        private ConfirmFixture(
            ConfirmMatchHandler handler,
            Match match,
            CallCountingMembershipRepository memberships,
            ConfirmFakeUnitOfWork unitOfWork,
            CapturingConfirmPublisher publisher,
            Guid ownerUserId)
        {
            Handler = handler;
            Match = match;
            Memberships = memberships;
            UnitOfWork = unitOfWork;
            Publisher = publisher;
            OwnerUserId = ownerUserId;
        }

        public ConfirmMatchHandler Handler { get; }

        public Match Match { get; }

        public CallCountingMembershipRepository Memberships { get; }

        public ConfirmFakeUnitOfWork UnitOfWork { get; }

        public CapturingConfirmPublisher Publisher { get; }

        public Guid OwnerUserId { get; }

        public Guid SquadId => Match.SquadId;

        public Guid MatchId => Match.Id;

        public static ConfirmFixture Create()
        {
            var squadStore = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            squadStore.AddCommittedSquad(squad);

            var ownerUserId = Guid.NewGuid();
            squadStore.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

            Match match = Match.CreateDraft(
                Guid.CreateVersion7(), squad.Id, Location, CandidateDays, Now).Value!;

            // The default minimum player threshold is 10, so seed exactly ten available members.
            for (int i = 0; i < ConfirmMatchHandler.DefaultMinimumPlayerThreshold; i++)
            {
                SquadMembership member =
                    SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), $"Player {i + 1}").Value!;
                squadStore.AddCommittedMembership(member);
                match.SubmitAvailability(member.Id, [CandidateDays[0]], Now.AddHours(i + 1));
            }

            var unitOfWork = new ConfirmFakeUnitOfWork();
            var publisher = new CapturingConfirmPublisher(ConfirmPublisherMode.Success, unitOfWork);
            var memberships = new CallCountingMembershipRepository(
                new FakeSquadMembershipRepository(squadStore));

            var handler = new ConfirmMatchHandler(
                new ConcealmentMatchRepository(match),
                new ConfirmFakeAvailabilityRepository([.. match.AvailabilityResponses]),
                memberships,
                new FakeSquadRepository(squadStore),
                unitOfWork,
                publisher,
                NullLogger<ConfirmMatchHandler>.Instance);

            return new ConfirmFixture(handler, match, memberships, unitOfWork, publisher, ownerUserId);
        }
    }

    /// <summary>
    /// Assembles the two participant operations over a <see cref="MatchState.Confirmed"/> match whose
    /// squad holds an acting owner and one active guest, optionally already a participant so a removal
    /// has something to remove.
    /// </summary>
    private sealed class ParticipantFixture
    {
        private ParticipantFixture(
            Match match,
            CallCountingMembershipRepository memberships,
            ConfirmFakeUnitOfWork unitOfWork,
            Guid ownerUserId,
            Guid guestMembershipId)
        {
            Match = match;
            Memberships = memberships;
            UnitOfWork = unitOfWork;
            OwnerUserId = ownerUserId;
            GuestMembershipId = guestMembershipId;

            var matches = new ConcealmentMatchRepository(match);
            AddHandler = new AddGuestParticipantHandler(matches, memberships, unitOfWork);
            RemoveHandler = new RemoveParticipantHandler(matches, memberships, unitOfWork);
        }

        public AddGuestParticipantHandler AddHandler { get; }

        public RemoveParticipantHandler RemoveHandler { get; }

        public Match Match { get; }

        public CallCountingMembershipRepository Memberships { get; }

        public ConfirmFakeUnitOfWork UnitOfWork { get; }

        public Guid OwnerUserId { get; }

        public Guid GuestMembershipId { get; }

        public Guid SquadId => Match.SquadId;

        public Guid MatchId => Match.Id;

        public static ParticipantFixture Create(bool seedGuestAsParticipant)
        {
            var squadStore = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            squadStore.AddCommittedSquad(squad);

            var ownerUserId = Guid.NewGuid();
            squadStore.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

            SquadMembership guest = SquadMembership
                .CreateGuest(squad.Id, "Dave", skillTier: null, lawfulBasisAckAt: Now)
                .Value!;
            squadStore.AddCommittedMembership(guest);

            Match match = Match.CreateDraft(
                Guid.CreateVersion7(), squad.Id, Location, CandidateDays, Now).Value!;

            // Both participant operations require the Confirmed state. Confirm directly on the
            // aggregate with a zero threshold so the fixture is not entangled with the availability
            // tally, which the confirmation tests above own.
            MatchResultTriad confirmed = match.Confirm(
                CandidateDays[0], availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
            Assert.True(confirmed.IsSuccess);

            if (seedGuestAsParticipant)
            {
                Result<MatchParticipant> added = match.AddParticipant(guest);
                Assert.True(added.IsSuccess);
            }

            var memberships = new CallCountingMembershipRepository(
                new FakeSquadMembershipRepository(squadStore));

            return new ParticipantFixture(
                match, memberships, new ConfirmFakeUnitOfWork(), ownerUserId, guest.Id);
        }
    }

    /// <summary>
    /// A counting decorator over an existing in-memory <see cref="ISquadMembershipRepository"/> fake.
    /// It adds nothing to the behaviour and delegates every member, existing solely so a test can
    /// assert the repository was <em>never called</em> on the squad-mismatch path — the observable
    /// consequence of the refusal preceding membership resolution (Requirement 7.6).
    /// </summary>
    private sealed class CallCountingMembershipRepository(ISquadMembershipRepository inner)
        : ISquadMembershipRepository
    {
        private readonly ISquadMembershipRepository _inner = inner;

        /// <summary>The number of calls to any member of the repository.</summary>
        public int CallCount { get; private set; }

        /// <summary>The number of acting-membership resolutions by backing user and squad.</summary>
        public int ResolutionCallCount { get; private set; }

        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        {
            CallCount++;
            ResolutionCallCount++;
            return _inner.GetByUserAndSquadAsync(userId, squadId, cancellationToken);
        }

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.GetByIdAsync(membershipId, cancellationToken);
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.AddAsync(membership, cancellationToken);
        }

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.ListForSquadAsync(squadId, activeOnly, cancellationToken);
        }

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.GetOwnerAsync(squadId, cancellationToken);
        }

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.IsSquadPendingDeletionAsync(squadId, cancellationToken);
        }

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.DisplayNameTakenAsync(squadId, normalisedName, excludingMembershipId, cancellationToken);
        }

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken)
        {
            CallCount++;
            return _inner.ListForUserAsync(userId, cancellationToken);
        }

        public void RemovePermanently(SquadMembership membership)
        {
            CallCount++;
            _inner.RemovePermanently(membership);
        }
    }

    /// <summary>
    /// In-memory <see cref="IAvailabilityRepository"/> holding at most one response per membership and
    /// counting its reads and writes separately, so a refused operation can be shown to have neither
    /// read the stored responses nor written one. Seeding bypasses the write path so the counters
    /// start at zero.
    /// </summary>
    private sealed class TrackingAvailabilityRepository : IAvailabilityRepository
    {
        private readonly Dictionary<Guid, AvailabilityResponse> _stored = [];

        /// <summary>The number of calls that listed the stored responses.</summary>
        public int ListCallCount { get; private set; }

        /// <summary>The number of calls that staged a change — an upsert or a removal.</summary>
        public int WriteCallCount { get; private set; }

        /// <summary>The number of responses currently stored.</summary>
        public int StoredResponseCount => _stored.Count;

        /// <summary>Seeds a stored response without counting it as a write.</summary>
        public void Seed(AvailabilityResponse response) => _stored[response.SquadMembershipId] = response;

        public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ListCallCount++;
            return Task.FromResult<IReadOnlyList<AvailabilityResponse>>([.. _stored.Values]);
        }

        public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_stored.GetValueOrDefault(squadMembershipId));
        }

        public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ArgumentNullException.ThrowIfNull(response);
            WriteCallCount++;
            _stored[response.SquadMembershipId] = response;
            return Task.CompletedTask;
        }

        public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ArgumentNullException.ThrowIfNull(response);
            WriteCallCount++;
            _stored.Remove(response.SquadMembershipId);
            return Task.CompletedTask;
        }
    }
}
