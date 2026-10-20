using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="GetMatchListHandler"/> — the match list read's success path and each of
/// its four refusal paths (Requirements 1.11, 5.9, 13.1).
/// <para>
/// The handler is constructed over hand-written in-memory fakes of the two Application abstractions
/// it depends on, so no database connection is opened and no <c>DbContext</c> is constructed, per the
/// Application-layer testing strategy (Requirement 13.1).
/// </para>
/// <para>
/// Two things are asserted of every refusal, and they are what the tests exist for. First, all four
/// refusals return the <b>same</b> uniform authorisation failure — the same
/// <see cref="MatchErrorCode"/> and the same non-disclosing message — so a caller cannot tell an
/// absent membership from an inactive one, from a membership of some other squad, from a squad that
/// does not exist or sits inside its deletion grace period (Requirement 5.9, 5.13). Second, a refusal
/// the <em>gate</em> decides invokes the query source <b>zero</b> times: this read's URL names the
/// squad rather than a match, so an unadmitted caller must cause no match query at all. The one
/// refusal that does reach the source is the source's own not-visible report, and that is asserted to
/// cost exactly one call and no more.
/// </para>
/// <para>
/// The gate's membership rules themselves are owned by
/// <see cref="MatchAuthorizationPropertyTests"/> and the concealment of the squad-scoped reads by
/// <see cref="SquadScopedConcealmentPropertyTests"/>; these tests cover this handler's own wiring —
/// the gate-before-query order, the declared limit it passes, and the truncation signal it carries
/// rather than computes.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class GetMatchListHandlerTests
{
    /// <summary>A fixed UTC anchor the fixture's instants are derived from.</summary>
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // ---------------------------------------------------------------------------------------------
    // Success path
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// An active member of the named squad receives the source's entries verbatim, in the source's
    /// order, and the handler asks the source for the squad it was given bounded by the match read
    /// surface's declared maximum rather than by a literal of its own
    /// (Requirements 1.10, 1.11, 11.4).
    /// </summary>
    [Fact]
    public async Task ActiveMember_ReturnsTheSourcesEntriesAndAsksForTheDeclaredMaximum()
    {
        MatchListEntry[] entries = [GatheringEntry(), CompletedEntry()];
        Fixture f = Fixture.WithActiveMember(new MatchListPage(entries, Truncated: false));

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(entries, result.Value!.Matches);
        Assert.False(result.Value.Truncated);

        RecordingMatchListSource.Call call = Assert.Single(f.Source.Calls);
        Assert.Equal(f.SquadId, call.SquadId);
        Assert.Equal(MatchListLimits.MaximumEntries, call.Limit);
    }

    /// <summary>
    /// The handler <b>carries</b> the source's truncation signal rather than recomputing it: both
    /// <see langword="true"/> and <see langword="false"/> reach
    /// <see cref="MatchList.Truncated"/> unchanged, and they do so for a page whose entry count is
    /// the same either way — so the reported value can only have come from the source, which is the
    /// party holding the <c>limit + 1</c>-th row (Requirements 1.10, 11.4).
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TruncationSignal_IsCarriedFromTheSourceUnchanged(bool truncated)
    {
        MatchListEntry[] entries = [GatheringEntry()];
        Fixture f = Fixture.WithActiveMember(new MatchListPage(entries, truncated));

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(truncated, result.Value!.Truncated);
        Assert.Single(result.Value.Matches);
    }

    /// <summary>
    /// A <b>visible</b> squad holding no admitted match is a success carrying zero entries and a false
    /// truncation member — not a concealment (Requirement 1.11). The source is still consulted,
    /// because only it can tell this case from a squad that is not visible.
    /// </summary>
    [Fact]
    public async Task VisibleSquadWithNoMatch_SucceedsWithZeroEntriesAndNoTruncation()
    {
        Fixture f = Fixture.WithActiveMember(new MatchListPage([], Truncated: false));

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.Matches);
        Assert.False(result.Value.Truncated);
        Assert.Single(f.Source.Calls);
    }

    // ---------------------------------------------------------------------------------------------
    // Refusal paths
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// A requester holding no membership of the named squad is refused with the uniform authorisation
    /// failure, and the source is never consulted (Requirements 1.11, 5.9).
    /// </summary>
    [Fact]
    public async Task AbsentActingMembership_RefusedUniformlyWithoutQueryingTheSource()
    {
        Fixture f = Fixture.WithNoMembership();

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        Assert.Empty(f.Source.Calls);
    }

    /// <summary>
    /// A membership of the named squad that is not <c>Active</c> — a member who left or was removed —
    /// is refused with the same uniform failure, and the source is never consulted
    /// (Requirements 1.11, 5.9).
    /// </summary>
    [Fact]
    public async Task InactiveActingMembership_RefusedUniformlyWithoutQueryingTheSource()
    {
        Fixture f = Fixture.WithInactiveMember();

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        Assert.Empty(f.Source.Calls);
    }

    /// <summary>
    /// A requester whose only membership is in a squad <em>other</em> than the one named is refused
    /// with the same uniform failure, and the source is never consulted. The sharp case is covered:
    /// the held membership is an <c>Owner</c>, so the test shows that a role carried in some other
    /// squad grants nothing in the squad the request names — resolution is scoped to
    /// <c>(user, squad)</c>, so the membership simply does not resolve here, and the refusal is
    /// indistinguishable from holding no membership at all (Requirements 5.9, 5.13).
    /// </summary>
    [Fact]
    public async Task MembershipOfAnotherSquad_RefusedUniformlyWithoutQueryingTheSource()
    {
        Fixture f = Fixture.WithOwnerOfADifferentSquad();

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        Assert.Empty(f.Source.Calls);
    }

    /// <summary>
    /// When the source reports the squad is not visible — it does not exist, or it is excluded by the
    /// soft-delete filter because it sits inside its deletion grace period — the handler returns the
    /// same uniform failure the gate returns, having consulted the source exactly once and no more
    /// (Requirements 1.11, 5.9, 5.13).
    /// </summary>
    [Fact]
    public async Task SourceReportsSquadNotVisible_RefusedUniformlyAfterExactlyOneQuery()
    {
        Fixture f = Fixture.WithActiveMember(page: null);

        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        RecordingMatchListSource.Call call = Assert.Single(f.Source.Calls);
        Assert.Equal(f.SquadId, call.SquadId);
    }

    /// <summary>
    /// All four refusal causes produce the <b>identical</b> failure. Asserting the four against each
    /// other — rather than each against an expected constant — is what shows they are mutually
    /// indistinguishable: a caller learns neither its own membership state nor whether the squad
    /// exists (Requirements 5.9, 5.13).
    /// </summary>
    [Fact]
    public async Task EveryRefusalCause_ProducesTheIdenticalFailure()
    {
        MatchError[] errors =
        [
            await RefuseAsync(Fixture.WithNoMembership()),
            await RefuseAsync(Fixture.WithInactiveMember()),
            await RefuseAsync(Fixture.WithOwnerOfADifferentSquad()),
            await RefuseAsync(Fixture.WithActiveMember(page: null)),
        ];

        MatchError first = errors[0];
        Assert.All(errors, error =>
        {
            Assert.Equal(first.Code, error.Code);
            Assert.Equal(first.Message, error.Message);
        });
    }

    // ---------------------------------------------------------------------------------------------
    // Shared assertions, entry builders and fixture
    // ---------------------------------------------------------------------------------------------

    /// <summary>
    /// Runs a fixture expected to refuse and returns the refusal's error, failing the test if the
    /// call unexpectedly succeeded.
    /// </summary>
    private static async Task<MatchError> RefuseAsync(Fixture f)
    {
        Result<MatchList> result = await f.Handler.HandleAsync(
            new GetMatchListCommand(f.ActingUserId, f.SquadId), CancellationToken.None);

        AssertUniformAuthorisationFailure(result);
        return result.Error!;
    }

    /// <summary>
    /// Asserts the handler reported the single uniform authorisation failure the match read surface
    /// already returns for any caller it will not serve, carrying no list and disclosing nothing
    /// (Requirement 5.9).
    /// </summary>
    private static void AssertUniformAuthorisationFailure(Result<MatchList> result)
    {
        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.NotNull(result.Error);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal("The requested action is not permitted.", result.Error.Message);
    }

    /// <summary>
    /// An entry shaped like a match that is gathering availability: candidate days, no confirmed day,
    /// no locked teams, no recorded result. The handler projects nothing, so the entries are opaque
    /// payloads to it — these builders exist only so the two shapes a list carries are both present
    /// on the success path.
    /// </summary>
    private static MatchListEntry GatheringEntry() =>
        new(
            MatchId: Guid.CreateVersion7(),
            State: MatchState.GatheringAvailability,
            Location: "Hackney Marshes, Pitch 12",
            ConfirmedDay: null,
            CandidateDays: [Now.AddDays(7), Now.AddDays(8)],
            ParticipantCount: 0,
            LockedTeams: [],
            RecordedResult: null,
            CompletedAt: null);

    /// <summary>
    /// An entry shaped like a completed match: a confirmed day, locked teams, a recorded result and a
    /// completion instant, with an empty candidate-day collection.
    /// </summary>
    private static MatchListEntry CompletedEntry()
    {
        var teamId = Guid.CreateVersion7();

        return new MatchListEntry(
            MatchId: Guid.CreateVersion7(),
            State: MatchState.Completed,
            Location: "Mabley Green",
            ConfirmedDay: Now.AddDays(-7),
            CandidateDays: [],
            ParticipantCount: 13,
            LockedTeams: [new LockedTeamSummary("The Invincibles", BibFlag: false), new LockedTeamSummary("Bib City", BibFlag: true)],
            RecordedResult: new RecordedResultView(
                ResultFidelity.Basic,
                [new TeamScore(teamId, 12), new TeamScore(Guid.CreateVersion7(), 8)]),
            CompletedAt: Now.AddDays(-7).AddHours(1));
    }

    /// <summary>
    /// Assembles <see cref="GetMatchListHandler"/> over a recording query source and an in-memory
    /// membership repository, with no database and no <c>DbContext</c> (Requirement 13.1). Each named
    /// factory seeds exactly one of the handler's five paths, leaving nothing else varying.
    /// </summary>
    private sealed class Fixture
    {
        private Fixture(RecordingMatchListSource source, MembershipArrangement seed)
        {
            Source = source;
            SquadId = seed.SquadId;
            ActingUserId = seed.ActingUserId;
            Handler = new GetMatchListHandler(source, seed.Repository);
        }

        public GetMatchListHandler Handler { get; }

        public RecordingMatchListSource Source { get; }

        /// <summary>The squad the request path names.</summary>
        public Guid SquadId { get; }

        public Guid ActingUserId { get; }

        /// <summary>An active registered member of the named squad, with the given page arranged.</summary>
        public static Fixture WithActiveMember(MatchListPage? page)
        {
            var squadId = Guid.NewGuid();
            var userId = Guid.NewGuid();
            SquadMembership acting = SquadMembership.CreateRegistered(squadId, userId, "Member").Value!;

            return new Fixture(
                new RecordingMatchListSource(page),
                new MembershipArrangement(
                    squadId, userId, new ConcealmentMembershipRepository(acting)));
        }

        /// <summary>
        /// A requester holding no membership anywhere. The page arranged would have succeeded, so the
        /// refusal is the gate's doing rather than an unservable fixture.
        /// </summary>
        public static Fixture WithNoMembership()
        {
            var squadId = Guid.NewGuid();

            return new Fixture(
                new RecordingMatchListSource(new MatchListPage([GatheringEntry()], Truncated: false)),
                new MembershipArrangement(
                    squadId, Guid.NewGuid(), new ConcealmentMembershipRepository()));
        }

        /// <summary>A membership of the named squad left inactive by leaving or removal.</summary>
        public static Fixture WithInactiveMember()
        {
            var squadId = Guid.NewGuid();
            var userId = Guid.NewGuid();
            SquadMembership acting = SquadMembership.CreateRegistered(squadId, userId, "Member").Value!;
            acting.Deactivate();

            return new Fixture(
                new RecordingMatchListSource(new MatchListPage([GatheringEntry()], Truncated: false)),
                new MembershipArrangement(
                    squadId, userId, new ConcealmentMembershipRepository(acting)));
        }

        /// <summary>
        /// A requester who owns a <em>different</em> squad and holds nothing in the one named, so the
        /// strongest role in the wrong squad grants nothing in the right one.
        /// </summary>
        public static Fixture WithOwnerOfADifferentSquad()
        {
            var namedSquadId = Guid.NewGuid();
            var otherSquadId = Guid.NewGuid();
            Assert.NotEqual(namedSquadId, otherSquadId);

            var userId = Guid.NewGuid();
            SquadMembership elsewhere =
                SquadMembership.CreateOwner(otherSquadId, userId, "Owner").Value!;

            return new Fixture(
                new RecordingMatchListSource(new MatchListPage([GatheringEntry()], Truncated: false)),
                new MembershipArrangement(
                    namedSquadId, userId, new ConcealmentMembershipRepository(elsewhere)));
        }
    }

    /// <summary>The three values a fixture's membership arrangement supplies to the handler.</summary>
    /// <param name="SquadId">The squad the request path names.</param>
    /// <param name="ActingUserId">The authenticated user making the request.</param>
    /// <param name="Repository">The membership repository the handler resolves the acting membership through.</param>
    private readonly record struct MembershipArrangement(
        Guid SquadId,
        Guid ActingUserId,
        ISquadMembershipRepository Repository);
}
