using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Tests.Auth;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// The guard for <b>Property 14 — Every read is gated as specified, and every refusal is
/// byte-identical</b> (match-read-models task 14.3), through the real pipeline against PostgreSQL.
/// <para>
/// For every authenticated caller, the list, detail, availability-tally and team-sheet reads succeed iff
/// the caller holds an <c>Active</c> membership of the target squad, and the working-teams read iff that
/// membership is a non-guest owner or admin. Every other outcome — across every applicable concealed
/// cause <b>and across all five reads</b> — is a <c>404</c> whose body bytes are identical, with no
/// <c>code</c> extension. Status and body bytes only are compared: no headers, trace values, size or
/// timing. Each read is shown refused for at least three distinct causes.
/// </para>
/// <para>
/// <b>Two exclusions, stated rather than discovered.</b> A missing or rejected token is not a concealed
/// cause — the framework answers <c>401</c> before any handler runs — and a malformed <c>{matchId}</c> is
/// answered by routing with an empty-bodied <c>404</c>, which must not be compared with the concealed
/// <c>ProblemDetails</c>. Both are covered by the per-endpoint tests (tasks 6.2, 10.8, 11.8). An active
/// <i>guest</i> cannot hold a token, so its admission is asserted at the handler level.
/// </para>
/// <para>
/// <b>Fragility to keep in mind:</b> this holds only because <c>AddProblemDetails()</c> is not
/// registered, so <c>TypedResults.Problem</c> writes a bare body with no <c>traceId</c>. Registering it
/// would put a per-request value into all five refusals at once; the existing
/// <c>SeamBehaviourPreservationProperties</c> traceId drift case already guards that, so no second
/// mechanism is added here.
/// </para>
/// <para><b>Validates: Requirements 5.1–5.5, 5.7–5.10, 10.5, 13.5.</b></para>
/// </summary>
public sealed class MatchReadGateProperties : IClassFixture<RoutingApiFactory>
{
    private static Task<World>? _world;
    private static int _memberNumber;
    private static readonly object WorldGate = new();

    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    public MatchReadGateProperties(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>The five concealing reads.</summary>
    public enum Read { List, Detail, Tally, Sheet, Teams }

    /// <summary>The callers, by their relationship to the squads.</summary>
    public enum Caller { OwnerA, AdminA, MemberA, InactiveA, MemberB, OwnerOfDeletedC, Stranger }

    /// <summary>The targets: an active squad's match, another active squad's match, a match in a squad in its grace period, and nothing.</summary>
    public enum Target { A, B, DeletedC, Absent }

    private static readonly Case[] AllCases =
    [
        .. from read in Enum.GetValues<Read>()
           from caller in Enum.GetValues<Caller>()
           from target in Enum.GetValues<Target>()
           select new Case(read, caller, target),
    ];

    // Feature: match-read-models, Property 14: Every read is gated as specified, and every refusal is
    // byte-identical.
    [Property(MaxTest = 140)]
    public Property EveryReadIsGatedAsSpecifiedAndEveryRefusalIsByteIdentical() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(AllCases)),
            testCase => RunAsync(async () =>
            {
                World world = await WorldAsync();
                using HttpClient client = Client();
                (HttpStatusCode status, byte[] body) = await SendAsync(client, world, testCase);
                byte[] reference = await ReferenceRefusalAsync(client, world);

                if (Admitted(testCase))
                {
                    Assert.Equal(HttpStatusCode.OK, status);
                }
                else
                {
                    Assert.Equal(HttpStatusCode.NotFound, status);
                    Assert.Equal(reference, body);
                }

                return true;
            }));

    /// <summary>
    /// The exhaustive companion: every case, every refusal byte-identical to every other, no <c>code</c>
    /// extension, and at least three distinct refusal causes exercised for each read.
    /// </summary>
    [Fact]
    public async Task EveryCase_AndAtLeastThreeCausesPerRead()
    {
        World world = await WorldAsync();
        using HttpClient client = Client();
        byte[] reference = await ReferenceRefusalAsync(client, world);
        var causes = Enum.GetValues<Read>().ToDictionary(static read => read, static _ => new HashSet<string>());

        foreach (Case testCase in AllCases)
        {
            (HttpStatusCode status, byte[] body) = await SendAsync(client, world, testCase);

            if (Admitted(testCase))
            {
                Assert.True(status == HttpStatusCode.OK, $"{testCase} should be admitted but was {(int)status}.");
                continue;
            }

            Assert.True(status == HttpStatusCode.NotFound, $"{testCase} should be refused but was {(int)status}.");
            Assert.True(reference.SequenceEqual(body), $"{testCase}'s refusal body differs from the concealed body.");
            causes[testCase.Read].Add(CauseOf(testCase));
        }

        using JsonDocument problem = JsonDocument.Parse(reference);
        Assert.False(problem.RootElement.TryGetProperty("code", out _));
        Assert.All(causes, static pair => Assert.True(
            pair.Value.Count >= 3,
            $"{pair.Key} was refused for only {pair.Value.Count} cause(s): {string.Join(", ", pair.Value)}."));
    }

    /// <summary>Whether the gate admits a case: an active membership of a visible target, and organiser rank for the working teams.</summary>
    private static bool Admitted(Case testCase)
    {
        bool member = (testCase.Target, testCase.Caller) switch
        {
            (Target.A, Caller.OwnerA or Caller.AdminA or Caller.MemberA) => true,
            (Target.B, Caller.MemberB) => true,
            _ => false,
        };

        return testCase.Read == Read.Teams
            ? member && testCase.Caller is Caller.OwnerA or Caller.AdminA && testCase.Target == Target.A
            : member;
    }

    /// <summary>Names the concealed cause of a refused case.</summary>
    private static string CauseOf(Case testCase) => testCase switch
    {
        { Target: Target.Absent, Read: Read.List } => "squad absent",
        { Target: Target.Absent } => "match absent",
        { Target: Target.DeletedC } => "squad in its grace period",
        { Caller: Caller.Stranger } => "no membership",
        { Caller: Caller.InactiveA, Target: Target.A } => "membership not active",
        { Read: Read.Teams, Caller: Caller.MemberA, Target: Target.A } or { Read: Read.Teams, Caller: Caller.MemberB, Target: Target.B } => "organiser gate",
        { Target: Target.A } or { Target: Target.B } => "membership in a different squad",
        _ => "other",
    };

    private async Task<(HttpStatusCode Status, byte[] Body)> SendAsync(HttpClient client, World world, Case testCase)
    {
        (Guid squad, Guid match) = testCase.Target switch
        {
            Target.A => (world.SquadA, world.MatchA),
            Target.B => (world.SquadB, world.MatchB),
            Target.DeletedC => (world.SquadC, world.MatchC),
            _ => (Guid.NewGuid(), Guid.NewGuid()),
        };

        string path = testCase.Read switch
        {
            Read.List => $"/squads/{squad}/matches",
            Read.Detail => $"/matches/{match}",
            Read.Tally => $"/squads/{squad}/matches/{match}/availability/tally",
            Read.Sheet => $"/matches/{match}/team-sheet",
            _ => $"/matches/{match}/teams",
        };

        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _factory.CreateAccessToken(world.Users[testCase.Caller]));
        using HttpResponseMessage response = await client.SendAsync(request);

        return (response.StatusCode, await response.Content.ReadAsByteArrayAsync());
    }

    /// <summary>The concealed refusal body: the shipped team-sheet read refused for a stranger.</summary>
    private async Task<byte[]> ReferenceRefusalAsync(HttpClient client, World world)
    {
        (HttpStatusCode status, byte[] body) = await SendAsync(client, world, new Case(Read.Sheet, Caller.Stranger, Target.A));
        Assert.Equal(HttpStatusCode.NotFound, status);
        return body;
    }

    private HttpClient Client() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private Task<World> WorldAsync()
    {
        lock (WorldGate)
        {
            return _world ??= SeedAsync();
        }
    }

    /// <summary>
    /// Seeds squad A (owner, admin, member, an inactive member, and players), squad B (a member and
    /// players) and squad C (an owner and players, soft-deleted afterwards so it sits in its grace
    /// period), each with one match locked to two teams, plus a user holding no membership.
    /// </summary>
    private async Task<World> SeedAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();
        DateTimeOffset now = _factory.Clock.GetUtcNow();
        var users = new Dictionary<Caller, Guid>();

        User NewUser(string name)
        {
            User user = User.Create(name, $"gate-{Guid.NewGuid():N}@example.com", emailVerified: true);
            db.Add(user);
            return user;
        }

        (Squad Squad, Match Match, List<SquadMembership> Members) NewSquad(string name, params (Caller? Caller, Func<Guid, Guid, SquadMembership> Create)[] named)
        {
            Squad squad = Squad.Create($"{name} {Guid.NewGuid():N}").Value!;
            db.Add(squad);
            var members = new List<SquadMembership>();

            foreach ((Caller? caller, Func<Guid, Guid, SquadMembership> create) in named)
            {
                User user = NewUser($"{name} {caller}");
                SquadMembership membership = create(squad.Id, user.Id);
                members.Add(membership);
                db.Add(membership);
                if (caller is { } c)
                {
                    users[c] = user.Id;
                }
            }

            while (members.Count(static m => m.State == MembershipState.Active) < 10)
            {
                User player = NewUser($"{name} player");
                SquadMembership membership = SquadMembership.CreateRegistered(squad.Id, player.Id, $"P{members.Count}").Value!;
                members.Add(membership);
                db.Add(membership);
            }

            Match match = Match.CreateDraft(Guid.CreateVersion7(), squad.Id, $"{name} pitch", [now.AddDays(7)], now).Value!;
            Assert.True(match.Confirm(now.AddDays(7), []).IsSuccess);
            List<SquadMembership> playing = [.. members.Where(static m => m.State == MembershipState.Active).Take(10)];
            foreach (SquadMembership player in playing)
            {
                Assert.True(match.AddParticipant(player).IsSuccess);
            }

            Assert.True(match.ApplyTeamProposal(
            [
                new ProposedTeam("Reds", BibFlag: false, [.. playing.Take(5).Select(static m => m.Id)]),
                new ProposedTeam("Bibs", BibFlag: true, [.. playing.Skip(5).Select(static m => m.Id)]),
            ]).IsSuccess);
            Assert.True(match.Lock().IsSuccess);
            db.Add(match);

            return (squad, match, members);
        }

        static SquadMembership Owner(Guid squad, Guid user) => SquadMembership.CreateOwner(squad, user, "Owner").Value!;
        static SquadMembership Member(Guid squad, Guid user) =>
            SquadMembership.CreateRegistered(squad, user, $"Member {Interlocked.Increment(ref _memberNumber)}").Value!;
        static SquadMembership Admin(Guid squad, Guid user)
        {
            SquadMembership admin = Member(squad, user);
            Assert.True(admin.PromoteToAdmin().IsSuccess);
            return admin;
        }

        static SquadMembership Inactive(Guid squad, Guid user)
        {
            SquadMembership inactive = Member(squad, user);
            inactive.Deactivate();
            return inactive;
        }

        var a = NewSquad("Gate A", (Caller.OwnerA, Owner), (Caller.AdminA, Admin), (Caller.MemberA, Member), (Caller.InactiveA, Inactive));
        var b = NewSquad("Gate B", (Caller.MemberB, Member));
        var c = NewSquad("Gate C", (Caller.OwnerOfDeletedC, Owner));
        users[Caller.Stranger] = NewUser("Gate stranger").Id;

        await db.SaveChangesAsync();

        // Into its grace period: the production save pipeline turns the removal into a soft-delete.
        db.Remove(c.Squad);
        await db.SaveChangesAsync();

        return new World(users, a.Squad.Id, a.Match.Id, b.Squad.Id, b.Match.Id, c.Squad.Id, c.Match.Id);
    }

    private static bool RunAsync(Func<Task<bool>> body) => body().GetAwaiter().GetResult();

    /// <summary>One caller reading one target through one read.</summary>
    public sealed record Case(Read Read, Caller Caller, Target Target)
    {
        public override string ToString() => $"{Read} by {Caller} on {Target}";
    }

    private sealed record World(
        IReadOnlyDictionary<Caller, Guid> Users,
        Guid SquadA, Guid MatchA, Guid SquadB, Guid MatchB, Guid SquadC, Guid MatchC);
}
