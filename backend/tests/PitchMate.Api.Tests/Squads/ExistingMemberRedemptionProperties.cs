using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Tests.Auth;
using PitchMate.Api.Tests.Serialisation;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// <b>Property 13 — Redemption by an existing member is still a success</b>.
/// <para>
/// <b>Validates: Requirements 6.3, 6.4</b>
/// </para>
/// <para>
/// This is the complement of the already-member <i>rejection</i> guard in this folder. Design D5 moves
/// <see cref="SquadErrorCode.AlreadyMember"/> to <c>409 Conflict</c> because its only reachable producers
/// are the two guest-claim paths — but redemption must not be dragged along with it.
/// <c>RedeemInviteHandler</c> models "the caller already holds an active membership" as a <b>success</b>
/// carrying <see cref="RedeemOutcome.AlreadyMember"/>, never as the error code, so that no-op stays a
/// <c>200 OK</c> (Requirement 6.4).
/// </para>
/// <para>
/// The point of asserting it is what it licenses: the redemption <c>200</c> carries <b>exactly one</b>
/// body shape, so it can be declared as a single response contract (Requirement 6.3). A <c>200</c> that
/// sometimes carried a <see cref="RedeemInviteResult"/> and sometimes carried nothing — which is what the
/// old bodiless mapping would have produced had the code ever reached this endpoint — could not be
/// declared at all. So the guard asserts the shape, not just the status: the body is an object whose
/// member set is exactly a <see cref="RedeemInviteResult"/>'s (so it is neither a problem body nor
/// absent), it deserialises to one through the host's own options, and its outcome member reports the
/// already-member outcome against the membership the caller already holds.
/// </para>
/// <para>
/// The outcome is read as a <i>name</i>, resolved from the configured
/// <see cref="JsonSerializerOptions"/> of the running host rather than spelled as a number, because the
/// wire contract now serialises every enum as its member name and rejects integers.
/// </para>
/// <para>
/// The situations are generated rather than exemplified: any usable invite (a token or short-code shaped
/// secret, non-expiring or expiring anywhere from the next tick to the far end of the permitted validity
/// window), arbitrary squad and caller identities, an active membership of any role the caller may hold,
/// and a request that supplies a display name or none — a name the already-member path never reads, which
/// is itself part of the claim that the outcome is decided by the membership alone.
/// </para>
/// <para>
/// It runs against the real Api host, so the property speaks about what reaches a client: real routing,
/// the JWT bearer pipeline, the real invite secret service (the stand-in matches on the hash it
/// produces), the real Application handler, and the real success/error seam. Only persistence is
/// substituted — the two scenario-backed stand-ins of this folder and <see cref="NoOpUnitOfWork"/> —
/// because an arbitrary already-member situation has to be reachable without a database, and the
/// already-member path returns before any commit anyway. Nothing that decides the status or shapes the
/// body is stubbed.
/// </para>
/// </summary>
public sealed class ExistingMemberRedemptionProperties : IClassFixture<AuthApiFactory>
{
    private const string RedeemRoute = "/squads/invites/redeem";

    private readonly ScenarioInviteRepository _invites = new();
    private readonly ScenarioRedemptionMembershipRepository _memberships = new();
    private readonly IInviteSecretService _secrets;
    private readonly JsonSerializerOptions _options;
    private readonly HttpClient _client;

    /// <summary>
    /// The wire member names of a <see cref="RedeemInviteResult"/>, derived by serialising one through the
    /// host's options rather than spelled out — so the shape assertion follows a rename of the record
    /// instead of going quietly stale. The non-vacuity fact pins what the derivation currently yields.
    /// </summary>
    private readonly string[] _resultMembers;

    /// <summary>
    /// Boots the real Api once for the class with persistence substituted, and resolves the JSON options
    /// and the invite secret service from that same host — so the request body this guard writes is the one
    /// the endpoint reads, and the hash the stand-in matches on is the one the handler computes.
    /// </summary>
    /// <param name="factory">The shared Api host factory, supplying the test configuration and clock.</param>
    public ExistingMemberRedemptionProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IInviteRepository>();
                services.AddSingleton<IInviteRepository>(_invites);
                services.RemoveAll<ISquadMembershipRepository>();
                services.AddSingleton<ISquadMembershipRepository>(_memberships);
                services.RemoveAll<IUnitOfWork>();
                services.AddSingleton<IUnitOfWork>(new NoOpUnitOfWork());
            }));

        _client = host.CreateClient();
        _options = host.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;
        _secrets = host.Services.GetRequiredService<IInviteSecretService>();

        _resultMembers = JsonSerializer
            .SerializeToElement(new RedeemInviteResult(Guid.Empty, RedeemOutcome.Joined), _options)
            .EnumerateObject()
            .Select(member => member.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
    }

    // Feature: api-response-contracts, Property 13: Redemption by an existing member is still a success.
    // Validates: Requirements 6.3, 6.4
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(InviteRedemptionGenerators) })]
    public Property Property13_RedeemingAUsableInviteAsAnActiveMemberIsAnAlreadyMemberSuccess(
        InviteRedemptionSituation situation)
    {
        ArgumentNullException.ThrowIfNull(situation);

        InviteRedemptionScenario scenario = Materialise(situation, situation.ExistingKind);
        _memberships.ForgetStagedMemberships();

        RedemptionResponseFacts facts = Redeem(scenario);
        IReadOnlyList<string> failures = OutcomeFailures(
            facts, RedeemOutcome.AlreadyMember, scenario.ExistingMembership!.Id);

        return (failures.Count == 0)
            .ToProperty()
            .Label($"redeem: {string.Join("; ", failures)}")
            .Classify(situation.ExpiresAfter is null, "non-expiring invite")
            .Classify(situation.ExistingKind == ExistingMembershipKind.ActiveOwner, "owner redeeming")
            .Classify(situation.ExistingKind == ExistingMembershipKind.ActiveAdmin, "admin redeeming")
            .Classify(situation.SuppliedDisplayName is null, "no display name supplied");
    }

    /// <summary>
    /// The non-vacuity floor. The property above would pass just as well against an endpoint that
    /// answered the same body to everything, so the control removes the one fact under test — the active
    /// membership the caller already holds — from otherwise identical situations and shows the answer
    /// changes with it.
    /// <list type="bullet">
    /// <item>A caller holding <i>no</i> membership is answered <see cref="RedeemOutcome.Joined"/>, and a
    /// membership really was staged: the already-member body is not a constant.</item>
    /// <item>A caller holding an <i>inactive</i> membership is answered
    /// <see cref="RedeemOutcome.Reactivated"/>, and that membership really was reactivated in place.</item>
    /// <item>All three outcomes produce <b>distinct</b> bodies, which is the same fact Requirement 6.3
    /// depends on from the other direction: one declared shape, three distinguishable values within it.
    /// The already-member case stages nothing, so it is the no-op the requirement calls it.</item>
    /// <item>Revoking the invite answers <c>410</c> instead, so the <c>200</c> is the <i>usable</i>
    /// invite's doing and not the endpoint's disposition.</item>
    /// <item>The wire vocabulary the guard reads is pinned literally, so a naming-policy or enum-name
    /// change is a visible failure here rather than a silently weakened assertion above.</item>
    /// </list>
    /// </summary>
    [Fact]
    public void TheRedemptionOutcomeSurfaceIsNonVacuous()
    {
        Assert.Equal("AlreadyMember", WireOutcome(RedeemOutcome.AlreadyMember));
        Assert.Equal("Joined", WireOutcome(RedeemOutcome.Joined));
        Assert.Equal("Reactivated", WireOutcome(RedeemOutcome.Reactivated));

        string[] expectedMembers = ["membershipId", "outcome"];
        Assert.Equal(expectedMembers, _resultMembers);

        foreach (InviteRedemptionSituation situation in InviteRedemptionGenerators.Controls)
        {
            var bodies = new List<string>();

            // The outcome under test: an active membership is confirmed, and nothing is staged for it.
            _memberships.ForgetStagedMemberships();
            InviteRedemptionScenario member = Materialise(situation, situation.ExistingKind);
            RedemptionResponseFacts confirmed = Redeem(member);

            Assert.Empty(OutcomeFailures(confirmed, RedeemOutcome.AlreadyMember, member.ExistingMembership!.Id));
            Assert.Empty(_memberships.Added);
            bodies.Add(confirmed.RawBody);

            // ...with that one fact removed, the same request joins the squad for real.
            _memberships.ForgetStagedMemberships();
            InviteRedemptionScenario newcomer = Materialise(situation, existingKind: null);
            RedemptionResponseFacts joined = Redeem(newcomer);

            SquadMembership staged = Assert.Single(_memberships.Added);
            Assert.Empty(OutcomeFailures(joined, RedeemOutcome.Joined, staged.Id));
            bodies.Add(joined.RawBody);

            // ...and an inactive membership is reactivated in place rather than confirmed or duplicated.
            _memberships.ForgetStagedMemberships();
            InviteRedemptionScenario returning = Materialise(situation, ExistingMembershipKind.InactiveMember);
            RedemptionResponseFacts reactivated = Redeem(returning);

            Assert.Empty(OutcomeFailures(reactivated, RedeemOutcome.Reactivated, returning.ExistingMembership!.Id));
            Assert.Equal(MembershipState.Active, returning.ExistingMembership!.State);
            Assert.Empty(_memberships.Added);
            bodies.Add(reactivated.RawBody);

            Assert.Equal(bodies.Count, bodies.Distinct(StringComparer.Ordinal).Count());

            // The 200 belongs to the usable invite: revoke it and the same caller is answered 410 Gone.
            Invite revoked = Invite.Create(member.SquadId, member.Invite.TokenHash, member.Invite.ExpiresAt);
            revoked.Revoke();

            _memberships.ForgetStagedMemberships();
            RedemptionResponseFacts gone = Redeem(member with { Invite = revoked });

            Assert.Equal(StatusCodes.Status410Gone, gone.Status);
        }
    }

    /// <summary>
    /// Everything that would make a response fail to be "a <c>200</c> carrying exactly one
    /// <see cref="RedeemInviteResult"/> reporting <paramref name="expected"/> for
    /// <paramref name="expectedMembershipId"/>", as readable reasons — empty when it is exactly that.
    /// Collected rather than thrown so a shrunk counterexample reports what came back.
    /// </summary>
    private IReadOnlyList<string> OutcomeFailures(
        RedemptionResponseFacts facts, RedeemOutcome expected, Guid expectedMembershipId)
    {
        var failures = new List<string>();

        // Requirement 6.4 — the no-op stays a success.
        if (facts.Status != StatusCodes.Status200OK)
        {
            failures.Add($"answered {facts.Status} with '{facts.RawBody}'");
            return failures;
        }

        // A problem body would be application/problem+json, so this also rules the seam out.
        if (facts.ContentType is not { } contentType
            || !contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
        {
            failures.Add($"content type is '{facts.ContentType}', not a JSON body");
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(facts.RawBody);
        }
        catch (JsonException exception)
        {
            failures.Add($"body '{facts.RawBody}' is not JSON: {exception.Message}");
            return failures;
        }

        using (document)
        {
            JsonElement root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object)
            {
                failures.Add($"body is a {root.ValueKind}, not a redemption result: '{facts.RawBody}'");
                return failures;
            }

            // Requirement 6.3 — the one shape this status carries. Member-set equality is what says the
            // body is a RedeemInviteResult and nothing else: not the bodiless 200 the corrected code used
            // to produce, and not a problem body (which would carry title/status/code instead).
            string[] members = root
                .EnumerateObject()
                .Select(member => member.Name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray();

            if (!members.SequenceEqual(_resultMembers, StringComparer.Ordinal))
            {
                failures.Add(
                    $"body members [{string.Join(", ", members)}] are not a redemption result "
                        + $"[{string.Join(", ", _resultMembers)}]: '{facts.RawBody}'");
                return failures;
            }
        }

        RedeemInviteResult? result;
        try
        {
            result = JsonSerializer.Deserialize<RedeemInviteResult>(facts.RawBody, _options);
        }
        catch (JsonException exception)
        {
            failures.Add($"body '{facts.RawBody}' is not a redemption result: {exception.Message}");
            return failures;
        }

        if (result is null)
        {
            failures.Add($"body '{facts.RawBody}' deserialised to no redemption result");
            return failures;
        }

        // Requirement 6.4 — the outcome the success reports, read as the name the wire contract emits.
        if (result.Outcome != expected)
        {
            failures.Add($"outcome is '{WireOutcome(result.Outcome)}', not '{WireOutcome(expected)}': '{facts.RawBody}'");
        }

        // The membership the caller holds in the squad — for this outcome, the one they already held.
        if (result.MembershipId != expectedMembershipId)
        {
            failures.Add($"membership is {result.MembershipId}, not {expectedMembershipId}: '{facts.RawBody}'");
        }

        return failures;
    }

    /// <summary>The wire value of a redemption outcome under the host's configured JSON contract.</summary>
    private string WireOutcome(RedeemOutcome outcome) =>
        JsonSerializer.SerializeToElement(outcome, _options).GetString()
        ?? throw new InvalidOperationException($"'{outcome}' did not serialise to a JSON string.");

    /// <summary>
    /// Materialises a generated situation into the entities the stand-ins serve: a usable invite for the
    /// situation's squad whose stored hash is the real hash of the presented secret, and the membership
    /// the redeeming caller already holds — of the requested kind, or none at all.
    /// </summary>
    /// <param name="situation">The generated situation.</param>
    /// <param name="existingKind">
    /// The kind of membership the caller already holds, or <see langword="null"/> for a caller who holds
    /// none. An active kind is the already-member condition the property asserts on; the control varies it.
    /// </param>
    private InviteRedemptionScenario Materialise(
        InviteRedemptionSituation situation, ExistingMembershipKind? existingKind)
    {
        DateTimeOffset? expiresAt = situation.ExpiresAfter is { } validity
            ? AuthApiTestConfig.FixedNow + validity
            : null;

        Invite invite = Invite.Create(situation.SquadId, _secrets.Hash(situation.PresentedSecret), expiresAt);

        SquadMembership? existing = existingKind is { } kind ? Membership(situation, kind) : null;

        return new InviteRedemptionScenario(
            situation.SquadId,
            situation.ActingUserId,
            situation.PresentedSecret,
            invite,
            existing,
            situation.SuppliedDisplayName);
    }

    /// <summary>The membership the redeeming caller already holds, in the requested kind.</summary>
    private static SquadMembership Membership(InviteRedemptionSituation situation, ExistingMembershipKind kind)
    {
        Guid squadId = situation.SquadId;
        Guid userId = situation.ActingUserId;
        string name = situation.ExistingDisplayName;

        switch (kind)
        {
            case ExistingMembershipKind.ActiveOwner:
                return SquadMembership.CreateOwner(squadId, userId, name).Value!;

            case ExistingMembershipKind.ActiveAdmin:
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, name).Value!;
                Assert.True(admin.PromoteToAdmin().IsSuccess);
                return admin;

            case ExistingMembershipKind.InactiveMember:
                SquadMembership left = SquadMembership.CreateRegistered(squadId, userId, name).Value!;
                Assert.True(left.Leave().IsSuccess);
                return left;

            default:
                return SquadMembership.CreateRegistered(squadId, userId, name).Value!;
        }
    }

    /// <summary>Drives <c>POST /squads/invites/redeem</c> for the scenario as its acting caller.</summary>
    private RedemptionResponseFacts Redeem(InviteRedemptionScenario scenario)
    {
        _invites.Scenario = scenario;
        _memberships.Scenario = scenario;

        string body = JsonSerializer.Serialize(
            new RedeemInviteRequest(scenario.PresentedSecret, scenario.SuppliedDisplayName), _options);

        using var request = new HttpRequestMessage(HttpMethod.Post, RedeemRoute)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };

        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", TestAccessTokens.ValidToken(scenario.ActingUserId));

        using HttpResponseMessage response = _client.SendAsync(request).GetAwaiter().GetResult();
        string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

        return new RedemptionResponseFacts(
            (int)response.StatusCode, response.Content.Headers.ContentType?.MediaType, responseBody);
    }
}

/// <summary>The parts of a redemption response this guard reasons about.</summary>
/// <param name="Status">The HTTP status code.</param>
/// <param name="ContentType">The response media type, or <see langword="null"/> when there is no body.</param>
/// <param name="RawBody">The response body exactly as it crossed the wire.</param>
public sealed record RedemptionResponseFacts(int Status, string? ContentType, string RawBody);

/// <summary>
/// One generated invite-redemption situation: the identities involved, the secret presented, how long the
/// invite remains usable, the kind of active membership the caller already holds, and the display name the
/// request carries (if any).
/// </summary>
/// <param name="SquadId">The squad the invite grants membership to.</param>
/// <param name="ActingUserId">The redeeming caller, stamped on the access token.</param>
/// <param name="PresentedSecret">The invite secret the request presents.</param>
/// <param name="ExpiresAfter">
/// How far past the pinned clock the invite expires, or <see langword="null"/> for a non-expiring invite.
/// Always strictly positive, so the invite is usable at the instant it is redeemed.
/// </param>
/// <param name="ExistingKind">The kind of active membership the caller already holds.</param>
/// <param name="ExistingDisplayName">That membership's display name.</param>
/// <param name="SuppliedDisplayName">The display name the request carries, or <see langword="null"/>.</param>
public sealed record InviteRedemptionSituation(
    Guid SquadId,
    Guid ActingUserId,
    string PresentedSecret,
    TimeSpan? ExpiresAfter,
    ExistingMembershipKind ExistingKind,
    string ExistingDisplayName,
    string? SuppliedDisplayName);

/// <summary>
/// FsCheck arbitraries for an invite-redemption situation. Identities are built from generated bytes
/// rather than <see cref="Guid.NewGuid"/> so a counterexample is reproducible from its seed, and are made
/// pairwise distinct by construction. The generated space is deliberately the whole <i>usable</i> window:
/// both secret shapes a client can present, a non-expiring invite as well as expiring ones from the
/// tightest surviving margin to the far end of the permitted validity range, every active role the caller
/// may hold, and a request that supplies a display name or none.
/// </summary>
public static class InviteRedemptionGenerators
{
    private const string NameChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'";
    private const string LetterChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    /// <summary>The URL-safe alphabet an invite link's token is rendered in.</summary>
    private const string TokenChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

    /// <summary>The Crockford base32 alphabet the human-typeable short code is rendered in.</summary>
    private const string CodeChars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    /// <summary>The roles an <i>active</i> membership may carry, which is the condition under test.</summary>
    private static readonly ExistingMembershipKind[] ActiveKinds =
    [
        ExistingMembershipKind.ActiveMember,
        ExistingMembershipKind.ActiveAdmin,
        ExistingMembershipKind.ActiveOwner,
    ];

    /// <summary>
    /// A small spread of explicit situations for the non-vacuity control — every active role, a
    /// non-expiring invite alongside an expiring one, and both secret shapes. Each supplies a display
    /// name, because the control also drives the fresh-join path, which reads one.
    /// </summary>
    public static IReadOnlyList<InviteRedemptionSituation> Controls { get; } =
    [
        Control(ExistingMembershipKind.ActiveMember, "control-token-member", expiresAfter: TimeSpan.FromDays(7)),
        Control(ExistingMembershipKind.ActiveAdmin, "CONTROLCODE9", expiresAfter: null),
        Control(ExistingMembershipKind.ActiveOwner, "control-token-owner", expiresAfter: Invite.MinValidity),
    ];

    /// <summary>Arbitrary for a generated invite-redemption situation.</summary>
    public static Arbitrary<InviteRedemptionSituation> InviteRedemptionSituation() => Arb.From(SituationGen());

    private static Gen<InviteRedemptionSituation> SituationGen() =>
        from ids in DistinctIdsGen(2)
        from secret in PresentedSecretGen()
        from expiresAfter in UsableValidityGen()
        from existingKind in Gen.Elements(ActiveKinds)
        from existingName in DisplayNameGen()
        from suppliedName in Gen.Frequency(
            (2, Gen.Constant<string?>(null)),
            (3, DisplayNameGen().Select(name => (string?)name)))
        select new InviteRedemptionSituation(
            ids[0], ids[1], secret, expiresAfter, existingKind, existingName, suppliedName);

    /// <summary>
    /// A presented secret in either shape a client can hold: the URL-safe token from an invite link, or
    /// the 8..12-character short code. The value only has to hash to the invite's stored hash, and the
    /// real hash is applied to whatever is generated here, so both shapes exercise the same match.
    /// </summary>
    private static Gen<string> PresentedSecretGen() =>
        Gen.Frequency(
            (3, from length in Gen.Choose(16, 48)
                from chars in Gen.ArrayOf(Gen.Elements(TokenChars.ToCharArray()), length)
                select new string(chars)),
            (2, from length in Gen.Choose(8, 12)
                from chars in Gen.ArrayOf(Gen.Elements(CodeChars.ToCharArray()), length)
                select new string(chars)));

    /// <summary>
    /// How far past the pinned clock the invite expires, spanning the whole window in which it is still
    /// redeemable: a non-expiring invite, the tightest margin that survives the strictly-after comparison,
    /// the shortest and longest validity the generating use case permits, and anything in between.
    /// </summary>
    private static Gen<TimeSpan?> UsableValidityGen() =>
        Gen.Frequency(
            (3, Gen.Constant<TimeSpan?>(null)),
            (1, Gen.Constant<TimeSpan?>(TimeSpan.FromTicks(1))),
            (1, Gen.Constant<TimeSpan?>(Invite.MinValidity)),
            (1, Gen.Constant<TimeSpan?>(Invite.MaxValidity)),
            (4, from minutes in Gen.Choose(1, (int)Invite.MaxValidity.TotalMinutes)
                select (TimeSpan?)TimeSpan.FromMinutes(minutes)));

    /// <summary>
    /// <paramref name="count"/> pairwise-distinct, non-empty identities. The trailing byte is stamped with
    /// the index so two generated identities can never coincide, and the leading byte's low bit is set so
    /// none can be <see cref="Guid.Empty"/> — which the redemption path rejects as a validation failure
    /// and would silently take the situation out from under the property.
    /// </summary>
    private static Gen<Guid[]> DistinctIdsGen(int count) =>
        from seeds in Gen.ArrayOf(Gen.ArrayOf(Gen.Choose(0, 255).Select(value => (byte)value), 16), count)
        select seeds.Select(Identity).ToArray();

    private static Guid Identity(byte[] bytes, int index)
    {
        bytes[0] |= 0x01;
        bytes[15] = (byte)index;
        return new Guid(bytes);
    }

    /// <summary>
    /// A display name of 2..50 characters that survives trimming: letters at both ends, anything the
    /// domain accepts in between, so interior spaces and punctuation are exercised without generating a
    /// name whose trimmed length falls outside the accepted range.
    /// </summary>
    private static Gen<string> DisplayNameGen() =>
        from interiorLength in Gen.Choose(0, 48)
        from interior in Gen.ArrayOf(Gen.Elements(NameChars.ToCharArray()), interiorLength)
        from first in Gen.Elements(LetterChars.ToCharArray())
        from last in Gen.Elements(LetterChars.ToCharArray())
        select first + new string(interior) + last;

    private static InviteRedemptionSituation Control(
        ExistingMembershipKind existingKind, string presentedSecret, TimeSpan? expiresAfter) =>
        new(
            Guid.Parse("55555555-5555-5555-5555-555555555500"),
            Guid.Parse("66666666-6666-6666-6666-666666666601"),
            presentedSecret,
            expiresAfter,
            existingKind,
            "Control Member",
            "Control Joiner");
}
