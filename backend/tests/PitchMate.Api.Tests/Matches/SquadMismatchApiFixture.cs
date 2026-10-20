using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Tests.Auth;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// Boots the real Api against a throwaway PostgreSQL container, seeds one world of squads, memberships and
/// matches into it, discovers the six squad-scoped operations' route templates off the running host, and
/// captures the <b>baseline</b> each refusal is compared against — all once, before any test runs.
/// <para>
/// The baseline is the whole point of the fixture. Requirement 7.8 does not ask whether a mismatched squad
/// produces "a 403" or "a 404": it asks whether the response is the one the <em>same operation</em> already
/// returns to a caller holding no membership in the match's squad. So for each of the six, the fixture
/// sends exactly that request — the match's own <c>squadId</c>, a user with no membership anywhere — and
/// keeps the bytes. Every later comparison is against a response the shipped surface genuinely produced,
/// never against a status this test decided was right.
/// </para>
/// <para>
/// Requests are sent through <see cref="RoutingApiFactory"/>'s client, so each one traverses the real JWT
/// bearer pipeline, the real route matching, the real endpoint filters and the real EF Core persistence.
/// Synchronous blocking at the seam (<c>GetAwaiter().GetResult()</c>) follows the established pattern for
/// the Api-level property tests here: FsCheck properties are synchronous, and the alternative — pre-capturing
/// every combination — cannot range over a generated squad identity.
/// </para>
/// <para>
/// Docker is required: the fixture starts a PostgreSQL container and applies the production EF migrations
/// to it, per the project's testing layering (no in-memory or SQLite substitute).
/// </para>
/// </summary>
public sealed class SquadMismatchApiFixture : IAsyncLifetime
{
    /// <summary>The number of active registered members who mark the candidate day of each seeded match.</summary>
    private const int AvailableMemberCount = ConfirmMatchHandler.DefaultMinimumPlayerThreshold;

    private const string Location = "Hackney Marshes, Pitch 12";

    /// <summary>
    /// The tables whose every column is compared before and after a refusal sweep. The set spans the match
    /// row, every child row the six operations can write, and the squad/membership rows they read, so an
    /// unintended <c>SaveChanges</c> — including one that only stamps an audit or soft-delete column —
    /// fails the comparison.
    /// </summary>
    private static readonly Type[] SnapshotEntityTypes =
    [
        typeof(Match),
        typeof(MatchParticipant),
        typeof(MatchTeam),
        typeof(AvailabilityResponse),
        typeof(Squad),
        typeof(SquadMembership),
    ];

    private static readonly JsonSerializerOptions BodyJson = new(JsonSerializerDefaults.Web);

    private readonly RoutingApiFactory _factory = new();

    private HttpClient _client = null!;
    private IReadOnlyDictionary<SquadScopedMatchOperation, CapturedMatchResponse> _baselines =
        new Dictionary<SquadScopedMatchOperation, CapturedMatchResponse>();
    private IReadOnlyDictionary<SquadScopedMatchOperation, SquadScopedMatchSuccessCase> _successCases =
        new Dictionary<SquadScopedMatchOperation, SquadScopedMatchSuccessCase>();

    /// <summary>The six operations as the running host mapped them.</summary>
    public IReadOnlyList<SquadScopedMatchRoute> Routes { get; private set; } = [];

    /// <summary>The seeded identities every request addresses.</summary>
    public SeededSquadMismatchWorld World { get; private set; } = null!;

    /// <summary>Starts the container, applies the migrations, seeds the world, and captures the baselines.</summary>
    public async Task InitializeAsync()
    {
        await ((IAsyncLifetime)_factory).InitializeAsync();

        _client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        Routes = SquadScopedMatchRoute.DiscoverFrom(_factory.Services.GetRequiredService<EndpointDataSource>());
        World = await SeedAsync();
        _successCases = BuildSuccessCases(World);
        _baselines = CaptureBaselines();
    }

    /// <summary>Disposes the client, the host and the container.</summary>
    public async Task DisposeAsync()
    {
        _client?.Dispose();
        await ((IAsyncLifetime)_factory).DisposeAsync();
    }

    /// <summary>
    /// The response <paramref name="operation"/> returns to an authenticated caller holding no membership in
    /// the match's squad, with the match's own <c>squadId</c> in the path — the response every mismatched
    /// squad must be indistinguishable from (Requirement 7.8).
    /// </summary>
    /// <param name="operation">The operation whose baseline is wanted.</param>
    /// <returns>The captured baseline response.</returns>
    public CapturedMatchResponse BaselineFor(SquadScopedMatchOperation operation) => _baselines[operation];

    /// <summary>The success path declared for <paramref name="operation"/>.</summary>
    /// <param name="operation">The operation whose success case is wanted.</param>
    /// <returns>The success case.</returns>
    public SquadScopedMatchSuccessCase SuccessCaseFor(SquadScopedMatchOperation operation) =>
        _successCases[operation];

    /// <summary>The route the running host mapped for <paramref name="operation"/>.</summary>
    /// <param name="operation">The operation whose route is wanted.</param>
    /// <returns>The discovered route.</returns>
    public SquadScopedMatchRoute RouteFor(SquadScopedMatchOperation operation) =>
        Routes.Single(route => route.Operation == operation);

    /// <summary>
    /// Sends <paramref name="scenario"/>: the probe match addressed through a squad that is <em>not</em> the
    /// squad the aggregate records for it, by the scenario's caller.
    /// </summary>
    /// <param name="scenario">The generated case to drive.</param>
    /// <returns>The captured response.</returns>
    public CapturedMatchResponse SendMismatch(SquadMismatchScenario scenario)
    {
        ArgumentNullException.ThrowIfNull(scenario);

        return Send(
            scenario.Operation,
            PathSquadIdFor(scenario),
            World.ProbeMatchId,
            World.ProbeParticipantMembershipId,
            World.ProbeGuestMembershipId,
            CallerUserIdFor(scenario.Caller));
    }

    /// <summary>
    /// Sends <paramref name="operation"/>'s success case: the match's own <c>squadId</c>, a caller the gate
    /// admits, a match in the required state.
    /// </summary>
    /// <param name="operation">The operation to drive to success.</param>
    /// <returns>The captured response.</returns>
    public CapturedMatchResponse SendSuccess(SquadScopedMatchOperation operation)
    {
        SquadScopedMatchSuccessCase success = SuccessCaseFor(operation);

        return Send(
            operation,
            World.MatchSquadId,
            success.MatchId,
            success.MembershipIdInPath,
            success.GuestMembershipIdInBody,
            success.CallerUserId);
    }

    /// <summary>
    /// The squad identity a scenario puts in the path: the second real squad, or the generated identity.
    /// <para>
    /// A generated identity that happened to equal the match's own squad would not be a mismatch at all, so
    /// it is replaced by the second real squad. The substitution is unreachable in practice — it needs a
    /// 122-bit collision — and exists so the property cannot pass on a case that was never a mismatch.
    /// </para>
    /// </summary>
    /// <param name="scenario">The scenario being driven.</param>
    /// <returns>A squad identity that is not the probe match's squad.</returns>
    public Guid PathSquadIdFor(SquadMismatchScenario scenario)
    {
        ArgumentNullException.ThrowIfNull(scenario);

        if (scenario.PathSquad == MismatchPathSquad.AnotherRealSquad)
        {
            return World.OtherSquadId;
        }

        return scenario.ArbitrarySquadId == World.MatchSquadId
            ? World.OtherSquadId
            : scenario.ArbitrarySquadId;
    }

    /// <summary>The user whose access token a scenario's caller sends.</summary>
    /// <param name="caller">The caller kind.</param>
    /// <returns>The user identity to stamp on the token's subject claim.</returns>
    public Guid CallerUserIdFor(MismatchCaller caller) => caller switch
    {
        MismatchCaller.OrganiserOfMatchSquad => World.OrganiserUserId,
        MismatchCaller.OwnerOfThePathSquadOnly => World.OtherSquadOwnerUserId,
        MismatchCaller.NoMembershipAnywhere => World.StrangerUserId,
        _ => throw new ArgumentOutOfRangeException(nameof(caller), caller, "Unhandled caller."),
    };

    /// <summary>
    /// Captures every column of every match-related row, so a refusal can be shown to have written nothing.
    /// <para>
    /// Read through raw SQL rather than through the entities, for two reasons: raw SQL is not subject to the
    /// global soft-delete query filter, so a row the refusal soft-deleted would still be seen; and
    /// <c>to_jsonb(row)</c> carries <em>every</em> mapped column — the audit instants, the actor columns, the
    /// soft-delete flag — without this helper listing them, so a column added later is compared without the
    /// snapshot being edited.
    /// </para>
    /// </summary>
    /// <returns>A stable textual rendering of every snapshot table's full contents.</returns>
    public async Task<string> CapturePersistedStateAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        var snapshot = new StringBuilder();

        foreach (Type entityType in SnapshotEntityTypes)
        {
            string table = db.Model.FindEntityType(entityType)?.GetTableName()
                ?? throw new InvalidOperationException($"{entityType.Name} is not a mapped entity type.");

            // The table name comes from the EF model, never from a caller, so the interpolation carries no
            // injection surface; the two values the query would otherwise need are not parameters at all.
            string sql =
                $"""SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)::text AS "Value" FROM "{table}" AS t""";

            string rows = await db.Database.SqlQueryRaw<string>(sql).SingleAsync();

            snapshot.Append(table).Append(" = ").AppendLine(rows);
        }

        return snapshot.ToString();
    }

    /// <summary>
    /// Sends one request through the real pipeline, substituting <b>every</b> parameter the discovered route
    /// template names and attaching an access token the host accepts.
    /// </summary>
    private CapturedMatchResponse Send(
        SquadScopedMatchOperation operation,
        Guid pathSquadId,
        Guid matchId,
        Guid membershipIdInPath,
        Guid guestMembershipIdInBody,
        Guid callerUserId)
    {
        SquadScopedMatchRoute route = RouteFor(operation);

        string path = route.BuildPath(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["squadId"] = pathSquadId.ToString(),
            ["matchId"] = matchId.ToString(),
            ["membershipId"] = membershipIdInPath.ToString(),
        });

        using var request = new HttpRequestMessage(new HttpMethod(route.Method), path)
        {
            Content = BodyFor(operation, guestMembershipIdInBody),
        };

        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", _factory.CreateAccessToken(callerUserId));

        using HttpResponseMessage response = _client.SendAsync(request).GetAwaiter().GetResult();
        byte[] body = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();

        return new CapturedMatchResponse((int)response.StatusCode, body);
    }

    /// <summary>
    /// The request body each operation requires, or <see langword="null"/> where it takes none.
    /// <para>
    /// A well-formed body matters even on the refusal path: a missing or unparseable body is rejected by the
    /// framework's binding with a <c>400</c> before the handler runs, so the property would be comparing
    /// binding failures rather than authorisation refusals. Every body is built from the Api's own request
    /// contract so a renamed member is a compile error here rather than a silent <c>400</c>.
    /// </para>
    /// </summary>
    private HttpContent? BodyFor(SquadScopedMatchOperation operation, Guid guestMembershipId) =>
        operation switch
        {
            SquadScopedMatchOperation.SubmitAvailabilityResponse => JsonContent.Create(
                new SubmitAvailabilityRequest([World.CandidateDay]), options: BodyJson),
            SquadScopedMatchOperation.ConfirmMatch => JsonContent.Create(
                new ConfirmMatchRequest(World.CandidateDay), options: BodyJson),
            SquadScopedMatchOperation.AddGuestParticipant => JsonContent.Create(
                new AddGuestParticipantRequest(guestMembershipId), options: BodyJson),
            _ => null,
        };

    /// <summary>
    /// Captures, for each of the six, the response a caller with no membership in the match's squad receives
    /// when the path names the match's <em>own</em> squad.
    /// </summary>
    private Dictionary<SquadScopedMatchOperation, CapturedMatchResponse> CaptureBaselines()
    {
        var baselines = new Dictionary<SquadScopedMatchOperation, CapturedMatchResponse>();

        foreach (SquadScopedMatchRoute route in Routes)
        {
            baselines[route.Operation] = Send(
                route.Operation,
                World.MatchSquadId,
                World.ProbeMatchId,
                World.ProbeParticipantMembershipId,
                World.ProbeGuestMembershipId,
                World.StrangerUserId);
        }

        return baselines;
    }

    /// <summary>
    /// Pairs each operation with a match in the state it requires and a caller its gate admits, and with the
    /// success status it produces today: <c>200 OK</c> for the four value-bearing operations, <c>204 No
    /// Content</c> for the two that return none.
    /// </summary>
    private static Dictionary<SquadScopedMatchOperation, SquadScopedMatchSuccessCase> BuildSuccessCases(
        SeededSquadMismatchWorld world) =>
        new()
        {
            [SquadScopedMatchOperation.SubmitAvailabilityResponse] = new(
                SquadScopedMatchOperation.SubmitAvailabilityResponse,
                world.GatheringMatchId,
                world.MemberUserId,
                world.ProbeParticipantMembershipId,
                world.AddableGuestMembershipId,
                StatusCodes.Status200OK),

            [SquadScopedMatchOperation.ClearAvailabilityResponse] = new(
                SquadScopedMatchOperation.ClearAvailabilityResponse,
                world.GatheringMatchId,
                world.MemberUserId,
                world.ProbeParticipantMembershipId,
                world.AddableGuestMembershipId,
                StatusCodes.Status204NoContent),

            [SquadScopedMatchOperation.GetAvailabilityTally] = new(
                SquadScopedMatchOperation.GetAvailabilityTally,
                world.GatheringMatchId,
                world.MemberUserId,
                world.ProbeParticipantMembershipId,
                world.AddableGuestMembershipId,
                StatusCodes.Status200OK),

            [SquadScopedMatchOperation.ConfirmMatch] = new(
                SquadScopedMatchOperation.ConfirmMatch,
                world.ConfirmableMatchId,
                world.OrganiserUserId,
                world.ProbeParticipantMembershipId,
                world.AddableGuestMembershipId,
                StatusCodes.Status200OK),

            [SquadScopedMatchOperation.AddGuestParticipant] = new(
                SquadScopedMatchOperation.AddGuestParticipant,
                world.ParticipantMatchId,
                world.OrganiserUserId,
                world.ProbeParticipantMembershipId,
                world.AddableGuestMembershipId,
                StatusCodes.Status200OK),

            [SquadScopedMatchOperation.RemoveParticipant] = new(
                SquadScopedMatchOperation.RemoveParticipant,
                world.ParticipantMatchId,
                world.OrganiserUserId,
                world.RemovableParticipantMembershipId,
                world.AddableGuestMembershipId,
                StatusCodes.Status204NoContent),
        };

    /// <summary>
    /// Seeds two squads, their memberships, and the four matches, committing through the running host's own
    /// <see cref="PitchMateDbContext"/> so every row is written exactly as the application writes it.
    /// </summary>
    private async Task<SeededSquadMismatchWorld> SeedAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        DateTimeOffset now = _factory.Clock.GetUtcNow();
        DateTimeOffset firstDay = now.AddDays(7);
        DateTimeOffset secondDay = now.AddDays(14);

        Squad matchSquad = Required(Squad.Create("Mismatch Squad A"), "the match's squad");
        Squad otherSquad = Required(Squad.Create("Mismatch Squad B"), "the second squad");

        User organiser = User.Create("Organiser A", UniqueEmail(), emailVerified: true);
        User otherOwner = User.Create("Owner B", UniqueEmail(), emailVerified: true);
        User stranger = User.Create("Stranger", UniqueEmail(), emailVerified: true);

        SquadMembership organiserMembership = Required(
            SquadMembership.CreateOwner(matchSquad.Id, organiser.Id, "Organiser A"), "the organiser");
        SquadMembership otherOwnerMembership = Required(
            SquadMembership.CreateOwner(otherSquad.Id, otherOwner.Id, "Owner B"), "the other squad's owner");

        // Enough active registered members, each marking the first candidate day, that the default
        // confirmation threshold is met by the confirmable match without the fixture configuring anything.
        var players = new List<(User User, SquadMembership Membership)>(AvailableMemberCount);

        for (int index = 1; index <= AvailableMemberCount; index++)
        {
            User user = User.Create($"Player {index}", UniqueEmail(), emailVerified: true);
            players.Add((
                user,
                Required(
                    SquadMembership.CreateRegistered(matchSquad.Id, user.Id, $"Player {index}"),
                    $"player {index}")));
        }

        SquadMembership probeGuest = Required(
            SquadMembership.CreateGuest(matchSquad.Id, "Probe Guest", skillTier: null, lawfulBasisAckAt: now),
            "the probe guest");
        SquadMembership addableGuest = Required(
            SquadMembership.CreateGuest(matchSquad.Id, "Addable Guest", skillTier: null, lawfulBasisAckAt: now),
            "the addable guest");

        db.AddRange(matchSquad, otherSquad);
        db.AddRange(organiser, otherOwner, stranger);
        db.AddRange(organiserMembership, otherOwnerMembership, probeGuest, addableGuest);

        foreach ((User user, SquadMembership membership) in players)
        {
            db.AddRange(user, membership);
        }

        await db.SaveChangesAsync();

        IReadOnlyList<RegisteredMember> registeredMembers =
        [
            .. players.Select(player => new RegisteredMember(player.Membership.Id, player.Membership.DisplayName)),
        ];

        Match Draft()
        {
            Match drafted = Required(
                Match.CreateDraft(Guid.CreateVersion7(), matchSquad.Id, Location, [firstDay, secondDay], now),
                "a match draft");

            foreach ((User _, SquadMembership membership) in players)
            {
                Required(drafted.SubmitAvailability(membership.Id, [firstDay], now), "a seeded availability response");
            }

            return drafted;
        }

        // The probe: Confirmed, with every available member seeded as a participant, so a request carrying
        // the match's own squad and an organiser's token would genuinely act — the refusal under test is
        // then caused by the squad in the path and nothing else.
        Match probe = Draft();
        Require(probe.Confirm(firstDay, registeredMembers.Count, minimumThreshold: 0, registeredMembers), "the probe match");

        Match gathering = Draft();
        Match confirmable = Draft();

        Match participantMatch = Draft();
        Require(
            participantMatch.Confirm(firstDay, registeredMembers.Count, minimumThreshold: 0, registeredMembers),
            "the participant match");

        db.AddRange(probe, gathering, confirmable, participantMatch);
        await db.SaveChangesAsync();

        return new SeededSquadMismatchWorld(
            MatchSquadId: matchSquad.Id,
            OtherSquadId: otherSquad.Id,
            OrganiserUserId: organiser.Id,
            OtherSquadOwnerUserId: otherOwner.Id,
            StrangerUserId: stranger.Id,
            MemberUserId: players[0].User.Id,
            ProbeMatchId: probe.Id,
            ProbeParticipantMembershipId: players[0].Membership.Id,
            ProbeGuestMembershipId: probeGuest.Id,
            GatheringMatchId: gathering.Id,
            ConfirmableMatchId: confirmable.Id,
            ParticipantMatchId: participantMatch.Id,
            AddableGuestMembershipId: addableGuest.Id,
            RemovableParticipantMembershipId: players[^1].Membership.Id,
            CandidateDay: firstDay);
    }

    private static string UniqueEmail() => $"mismatch-{Guid.NewGuid():N}@example.com";

    private static Squad Required(PitchMate.Domain.Squads.Result<Squad> result, string what) =>
        result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");

    private static SquadMembership Required(
        PitchMate.Domain.Squads.Result<SquadMembership> result, string what) =>
        result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");

    private static T Required<T>(PitchMate.Domain.Matches.Result<T> result, string what)
        where T : class =>
        result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");

    private static void Require(PitchMate.Domain.Matches.Result result, string what)
    {
        if (!result.IsSuccess)
        {
            throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");
        }
    }
}
