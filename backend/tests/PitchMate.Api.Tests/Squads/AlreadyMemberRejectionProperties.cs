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
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// The backend conjunct of <b>Property 12 — Already-member is a rejection on both sides of the wire</b>.
/// <para>
/// <b>Validates: Requirements 6.1, 6.2, 6.6</b>
/// </para>
/// <para>
/// <see cref="SquadErrorCode.AlreadyMember"/> used to answer a bodiless <c>200 OK</c>, on reasoning that
/// no longer describes any reachable path: the redemption no-op is a <i>success</i> carrying
/// <c>RedeemOutcome.AlreadyMember</c> and never produces the error code, so the only producers are
/// guest-claim initiation and completion — where "the target user already holds a membership" is a
/// rejection. Design D5 maps it to <c>409 Conflict</c> with a problem body.
/// </para>
/// <para>
/// The unit-level mapping is already pinned by <see cref="SquadErrorResultsTests"/>. What that cannot
/// say is that the corrected status is what a client actually receives from the two endpoints that
/// produce the code: the seam could be right while an endpoint short-circuits, conceals, or is answered
/// earlier by authorisation. This guard therefore asserts the claim end to end, over generated
/// situations rather than one example — arbitrary squad, acting, membership and target identities,
/// arbitrary guest and existing-member display names and skill tier, either authorised acting role, any
/// kind of membership the target already holds (active owner, admin or member, or an inactive one), a
/// target who is sometimes the acting admin themselves, and — for completion — an open claim in either
/// of the two states that path can reach it in.
/// </para>
/// <para>
/// Two conjuncts are asserted together because neither alone is the requirement. The response
/// <b>status is 409</b> (Requirement 6.2), and the body is a <b>problem carrying the <c>code</c>
/// extension</b> naming the rejection (Requirement 6.1), which is the value the web client branches on
/// to present a rejected-input outcome (Requirement 6.6). The <c>code</c> assertion is what makes the
/// property discriminating rather than decorative: <see cref="SquadErrorCode.ClaimNotEligible"/> — the
/// failure a mis-ordered handler or a mis-wired stand-in would produce instead — answers <c>409</c> too,
/// so status alone would pass against the wrong rejection.
/// </para>
/// <para>
/// It runs against the real Api host, so the property speaks about what reaches a client: real routing,
/// the JWT bearer pipeline, the real Application handlers, and the real <see cref="SquadErrorResults"/>
/// seam. Only persistence is substituted — the three repository stand-ins of this folder and
/// <see cref="NoOpUnitOfWork"/> — because an arbitrary already-member situation has to be reachable
/// without a database, and the already-member path returns before any commit anyway. Nothing that
/// decides the status or shapes the body is stubbed.
/// </para>
/// <para>
/// The web conjunct — that the squads feature maps this <c>409</c> to a rejected-input outcome — is
/// re-asserted by the squads-module migration against the same response.
/// </para>
/// </summary>
public sealed class AlreadyMemberRejectionProperties : IClassFixture<AuthApiFactory>
{
    /// <summary>The problem code both guest-claim paths report when the target already holds a membership.</summary>
    private const string ExpectedCode = nameof(SquadErrorCode.AlreadyMember);

    private readonly ResolvingSquadRepository _squads = new();
    private readonly ScenarioMembershipRepository _memberships = new();
    private readonly ScenarioGuestClaimRepository _claims = new();
    private readonly JsonSerializerOptions _options;
    private readonly HttpClient _client;

    /// <summary>
    /// Boots the real Api once for the class with persistence substituted, and resolves the JSON options
    /// from that same host so the request body this guard writes is the one the endpoint reads.
    /// </summary>
    /// <param name="factory">The shared Api host factory, supplying the test configuration and clock.</param>
    public AlreadyMemberRejectionProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ISquadRepository>();
                services.AddSingleton<ISquadRepository>(_squads);
                services.RemoveAll<ISquadMembershipRepository>();
                services.AddSingleton<ISquadMembershipRepository>(_memberships);
                services.RemoveAll<IGuestClaimRepository>();
                services.AddSingleton<IGuestClaimRepository>(_claims);
                services.RemoveAll<IUnitOfWork>();
                services.AddSingleton<IUnitOfWork>(new NoOpUnitOfWork());
            }));

        _client = host.CreateClient();
        _options = host.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;
    }

    // Feature: api-response-contracts, Property 12: Already-member is a rejection on both sides of the wire.
    // Validates: Requirements 6.1, 6.2, 6.6
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GuestClaimScenarioGenerators) })]
    public Property Property12_InitiatingAClaimOntoAnExistingMemberIsRejectedAsAConflict(GuestClaimSituation situation)
    {
        ArgumentNullException.ThrowIfNull(situation);

        GuestClaimResponseFacts facts = Initiate(Materialise(situation, targetAlreadyHoldsMembership: true));
        IReadOnlyList<string> failures = RejectionFailures(facts);

        return (failures.Count == 0)
            .ToProperty()
            .Label($"initiate: {string.Join("; ", failures)}")
            .Classify(situation.TargetIsActingUser, "target is the acting admin")
            .Classify(!situation.ActingIsOwner, "acting admin")
            .Classify(situation.ExistingKind == ExistingMembershipKind.InactiveMember, "target's membership inactive");
    }

    // Feature: api-response-contracts, Property 12: Already-member is a rejection on both sides of the wire.
    // Validates: Requirements 6.1, 6.2, 6.6
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GuestClaimScenarioGenerators) })]
    public Property Property12_CompletingAClaimOntoAnExistingMemberIsRejectedAsAConflict(GuestClaimSituation situation)
    {
        ArgumentNullException.ThrowIfNull(situation);

        GuestClaimResponseFacts facts = Complete(Materialise(situation, targetAlreadyHoldsMembership: true));
        IReadOnlyList<string> failures = RejectionFailures(facts);

        return (failures.Count == 0)
            .ToProperty()
            .Label($"complete: {string.Join("; ", failures)}")
            .Classify(situation.ConsentRecorded, "consented claim")
            .Classify(!situation.ConsentRecorded, "pending claim")
            .Classify(situation.TargetIsActingUser, "target is the acting admin");
    }

    /// <summary>
    /// The non-vacuity floor. Both properties above could pass against a surface that answers <c>409</c>
    /// to everything, or against a stand-in that never resolves anything and is rejected for an unrelated
    /// reason. The control removes the one fact under test — the membership the target already holds —
    /// from otherwise identical situations, and shows both paths then <b>succeed</b>: initiation answers
    /// <c>200</c> and really stages a claim, completion answers <c>204</c> and really rebinds the guest.
    /// <para>
    /// It also pins the rejection code literally rather than only via <see cref="ExpectedCode"/>, so the
    /// value the web client branches on is visible in the source; and asserts that the rejection is
    /// <i>not</i> the neighbouring <see cref="SquadErrorCode.ClaimNotEligible"/>, which shares the
    /// <c>409</c> status and would otherwise satisfy a status-only reading of the requirement.
    /// </para>
    /// </summary>
    [Fact]
    public void TheAlreadyMemberRejectionIsNonVacuous()
    {
        Assert.Equal("AlreadyMember", ExpectedCode);

        foreach (GuestClaimSituation situation in GuestClaimScenarioGenerators.Controls)
        {
            // With the target already a member, both paths are the rejection under test — and it is the
            // already-member rejection specifically, not the 409 its neighbouring code would answer.
            GuestClaimResponseFacts rejectedInitiation =
                Initiate(Materialise(situation, targetAlreadyHoldsMembership: true));
            Assert.Empty(RejectionFailures(rejectedInitiation));
            Assert.DoesNotContain(
                nameof(SquadErrorCode.ClaimNotEligible), rejectedInitiation.RawBody, StringComparison.Ordinal);

            GuestClaimResponseFacts rejectedCompletion =
                Complete(Materialise(situation, targetAlreadyHoldsMembership: true));
            Assert.Empty(RejectionFailures(rejectedCompletion));
            Assert.DoesNotContain(
                nameof(SquadErrorCode.ClaimNotEligible), rejectedCompletion.RawBody, StringComparison.Ordinal);

            // ...and with that one fact removed, both paths succeed, so the 409 is that fact's doing.
            GuestClaimScenario open = Materialise(situation, targetAlreadyHoldsMembership: false);
            _claims.ForgetStagedClaims();

            GuestClaimResponseFacts initiated = Initiate(open);
            Assert.Equal(StatusCodes.Status200OK, initiated.Status);
            GuestClaim staged = Assert.Single(_claims.StagedClaims);
            Assert.Equal(open.TargetUserId, staged.TargetUserId);
            Assert.Contains(staged.Id.ToString(), initiated.RawBody, StringComparison.OrdinalIgnoreCase);

            // Completion needs a consented claim to get past the consent gate; the situation's own claim
            // state is exercised by the property above, so the control fixes it to the state that passes.
            GuestClaimScenario completable = Materialise(situation, targetAlreadyHoldsMembership: false) with
            {
                OpenClaim = Consented(open.MembershipId, open.TargetUserId),
            };

            GuestClaimResponseFacts completed = Complete(completable);
            Assert.Equal(StatusCodes.Status204NoContent, completed.Status);
            Assert.Equal(completable.TargetUserId, completable.TargetMembership!.UserId);
        }
    }

    /// <summary>
    /// Everything that would make a response fail to be "a <c>409</c> carrying a problem body with the
    /// already-member <c>code</c>", as readable reasons — empty when it is exactly that. Collected rather
    /// than thrown so a shrunk counterexample reports what came back.
    /// </summary>
    private static IReadOnlyList<string> RejectionFailures(GuestClaimResponseFacts facts)
    {
        var failures = new List<string>();

        // Requirement 6.2 — the rejection answers with a rejection status.
        if (facts.Status != StatusCodes.Status409Conflict)
        {
            failures.Add($"answered {facts.Status} with '{facts.RawBody}'");
            return failures;
        }

        if (facts.ContentType is not { } contentType
            || !contentType.StartsWith("application/problem+json", StringComparison.OrdinalIgnoreCase))
        {
            failures.Add($"content type is '{facts.ContentType}', not a problem body");
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

            // Requirement 6.1 — a body, where this code used to carry none at all.
            if (root.ValueKind != JsonValueKind.Object)
            {
                failures.Add($"body is a {root.ValueKind}, not a problem object: '{facts.RawBody}'");
                return failures;
            }

            if (!root.TryGetProperty("status", out JsonElement status)
                || status.ValueKind != JsonValueKind.Number
                || status.GetInt32() != StatusCodes.Status409Conflict)
            {
                failures.Add($"problem body does not report status 409: '{facts.RawBody}'");
            }

            if (!root.TryGetProperty("title", out JsonElement title) || title.GetString() != ExpectedCode)
            {
                failures.Add($"problem title is not '{ExpectedCode}': '{facts.RawBody}'");
            }

            // The branchable value: without it a client cannot tell this rejection from any other 409.
            if (!root.TryGetProperty("code", out JsonElement code))
            {
                failures.Add($"problem body carries no 'code' extension: '{facts.RawBody}'");
            }
            else if (code.ValueKind != JsonValueKind.String || code.GetString() != ExpectedCode)
            {
                failures.Add($"'code' is not '{ExpectedCode}' but '{code}': '{facts.RawBody}'");
            }
        }

        return failures;
    }

    /// <summary>
    /// Materialises a generated situation into the entities the stand-ins serve. The acting caller is an
    /// active owner or admin, so authorisation passes and the rejection under test is the reason the
    /// request fails; the claim target is a guest membership of the same squad, so target eligibility
    /// passes too.
    /// </summary>
    /// <param name="situation">The generated situation.</param>
    /// <param name="targetAlreadyHoldsMembership">
    /// Whether the target user already holds a membership in the squad — the one fact the properties
    /// assert on and the control removes.
    /// </param>
    private static GuestClaimScenario Materialise(GuestClaimSituation situation, bool targetAlreadyHoldsMembership)
    {
        SquadMembership acting = situation.ActingIsOwner
            ? SquadMembership.CreateOwner(situation.SquadId, situation.ActingUserId, "Acting Owner").Value!
            : Admin(situation.SquadId, situation.ActingUserId, "Acting Admin");

        SquadMembership guest = SquadMembership.CreateGuest(
            situation.SquadId, situation.GuestDisplayName, situation.GuestSkillTier, AuthApiTestConfig.FixedNow).Value!;

        // A target who is the acting admin themselves already holds a membership by construction, so that
        // case is only reachable as a rejection; the control always uses the distinct generated identity.
        Guid targetUserId = situation.TargetIsActingUser && targetAlreadyHoldsMembership
            ? situation.ActingUserId
            : situation.TargetUserId;

        SquadMembership? existing = targetAlreadyHoldsMembership
            ? ExistingMembership(situation, targetUserId)
            : null;

        GuestClaim claim = GuestClaim.Initiate(situation.MembershipId, targetUserId);
        if (situation.ConsentRecorded)
        {
            Assert.True(claim.RecordConsent(AuthApiTestConfig.FixedNow).IsSuccess);
        }

        return new GuestClaimScenario(
            situation.SquadId,
            situation.ActingUserId,
            acting,
            situation.MembershipId,
            guest,
            targetUserId,
            existing,
            claim);
    }

    /// <summary>The membership the target user already holds, in the generated kind.</summary>
    private static SquadMembership ExistingMembership(GuestClaimSituation situation, Guid targetUserId)
    {
        Guid squadId = situation.SquadId;
        string name = situation.ExistingDisplayName;

        switch (situation.ExistingKind)
        {
            case ExistingMembershipKind.ActiveOwner:
                return SquadMembership.CreateOwner(squadId, targetUserId, name).Value!;

            case ExistingMembershipKind.ActiveAdmin:
                return Admin(squadId, targetUserId, name);

            case ExistingMembershipKind.InactiveMember:
                SquadMembership left = SquadMembership.CreateRegistered(squadId, targetUserId, name).Value!;
                Assert.True(left.Leave().IsSuccess);
                return left;

            default:
                return SquadMembership.CreateRegistered(squadId, targetUserId, name).Value!;
        }
    }

    private static SquadMembership Admin(Guid squadId, Guid userId, string displayName)
    {
        SquadMembership membership = SquadMembership.CreateRegistered(squadId, userId, displayName).Value!;
        Assert.True(membership.PromoteToAdmin().IsSuccess);
        return membership;
    }

    private static GuestClaim Consented(Guid membershipId, Guid targetUserId)
    {
        GuestClaim claim = GuestClaim.Initiate(membershipId, targetUserId);
        Assert.True(claim.RecordConsent(AuthApiTestConfig.FixedNow).IsSuccess);
        return claim;
    }

    /// <summary>Drives <c>POST /squads/{squadId}/guests/{membershipId}/claims</c> for the scenario.</summary>
    private GuestClaimResponseFacts Initiate(GuestClaimScenario scenario)
    {
        string body = JsonSerializer.Serialize(new InitiateGuestClaimRequest(scenario.TargetUserId), _options);

        return Send(
            scenario,
            $"/squads/{scenario.SquadId}/guests/{scenario.MembershipId}/claims",
            new StringContent(body, Encoding.UTF8, "application/json"));
    }

    /// <summary>Drives <c>POST /squads/{squadId}/guests/{membershipId}/claims/complete</c> for the scenario.</summary>
    private GuestClaimResponseFacts Complete(GuestClaimScenario scenario) =>
        Send(scenario, $"/squads/{scenario.SquadId}/guests/{scenario.MembershipId}/claims/complete", content: null);

    private GuestClaimResponseFacts Send(GuestClaimScenario scenario, string route, HttpContent? content)
    {
        _memberships.Scenario = scenario;
        _claims.Scenario = scenario;

        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", TestAccessTokens.ValidToken(scenario.ActingUserId));

        using HttpResponseMessage response = _client.SendAsync(request).GetAwaiter().GetResult();
        string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

        return new GuestClaimResponseFacts(
            (int)response.StatusCode, response.Content.Headers.ContentType?.MediaType, responseBody);
    }
}

/// <summary>The parts of a guest-claim response this guard reasons about.</summary>
/// <param name="Status">The HTTP status code.</param>
/// <param name="ContentType">The response media type, or <see langword="null"/> when there is no body.</param>
/// <param name="RawBody">The response body exactly as it crossed the wire.</param>
public sealed record GuestClaimResponseFacts(int Status, string? ContentType, string RawBody);

/// <summary>The kind of membership a target user already holds in the squad.</summary>
public enum ExistingMembershipKind
{
    /// <summary>An active member — the ordinary case.</summary>
    ActiveMember,

    /// <summary>An active admin.</summary>
    ActiveAdmin,

    /// <summary>The squad's active owner.</summary>
    ActiveOwner,

    /// <summary>A membership that has been left, so it is retained but inactive. Still a membership.</summary>
    InactiveMember,
}

/// <summary>
/// One generated guest-claim situation: the identities the routes carry, the acting caller's authorised
/// role, the guest membership being claimed, the kind of membership the target already holds, whether the
/// target is the acting admin themselves, and whether the open claim has recorded consent.
/// </summary>
/// <param name="SquadId">The squad identity in the route.</param>
/// <param name="ActingUserId">The caller stamped on the access token.</param>
/// <param name="MembershipId">The membership identity in the route.</param>
/// <param name="TargetUserId">The user the claim is made onto, distinct from <paramref name="ActingUserId"/>.</param>
/// <param name="TargetIsActingUser">Whether the claim targets the acting admin themselves instead.</param>
/// <param name="ActingIsOwner">Whether the acting caller is the owner rather than an admin.</param>
/// <param name="GuestDisplayName">The guest membership's display name.</param>
/// <param name="GuestSkillTier">The guest's cold-start tier seed, or <see langword="null"/>.</param>
/// <param name="ExistingDisplayName">The display name of the membership the target already holds.</param>
/// <param name="ExistingKind">The kind of membership the target already holds.</param>
/// <param name="ConsentRecorded">Whether the open claim has recorded the target's consent.</param>
public sealed record GuestClaimSituation(
    Guid SquadId,
    Guid ActingUserId,
    Guid MembershipId,
    Guid TargetUserId,
    bool TargetIsActingUser,
    bool ActingIsOwner,
    string GuestDisplayName,
    SkillTier? GuestSkillTier,
    string ExistingDisplayName,
    ExistingMembershipKind ExistingKind,
    bool ConsentRecorded);

/// <summary>
/// FsCheck arbitraries for a guest-claim situation. Identities are built from generated bytes rather than
/// <see cref="Guid.NewGuid"/> so a counterexample is reproducible from its seed, and are made pairwise
/// distinct by construction so a scenario never collapses two roles onto one identity by accident.
/// Display names span the full 2..50 characters the domain accepts, including interior spaces.
/// </summary>
public static class GuestClaimScenarioGenerators
{
    private const string NameChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'";
    private const string LetterChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    private static readonly ExistingMembershipKind[] AllExistingKinds =
        Enum.GetValues<ExistingMembershipKind>();

    /// <summary>
    /// A small spread of explicit situations for the non-vacuity control — both acting roles, both claim
    /// states, a self-target, and every kind of membership the target may already hold.
    /// </summary>
    public static IReadOnlyList<GuestClaimSituation> Controls { get; } =
    [
        Control(ExistingMembershipKind.ActiveMember, actingIsOwner: true, targetIsActingUser: false, consentRecorded: false),
        Control(ExistingMembershipKind.ActiveAdmin, actingIsOwner: false, targetIsActingUser: false, consentRecorded: true),
        Control(ExistingMembershipKind.ActiveOwner, actingIsOwner: true, targetIsActingUser: true, consentRecorded: true),
        Control(ExistingMembershipKind.InactiveMember, actingIsOwner: false, targetIsActingUser: false, consentRecorded: false),
    ];

    /// <summary>Arbitrary for a generated guest-claim situation.</summary>
    public static Arbitrary<GuestClaimSituation> GuestClaimSituation() => Arb.From(SituationGen());

    private static Gen<GuestClaimSituation> SituationGen() =>
        from ids in DistinctIdsGen(4)
        from targetIsActingUser in Gen.Frequency((4, Gen.Constant(false)), (1, Gen.Constant(true)))
        from actingIsOwner in Gen.Elements(true, false)
        from guestName in DisplayNameGen()
        from tier in Gen.Elements<SkillTier?>(null, SkillTier.Beginner, SkillTier.Average, SkillTier.Strong)
        from existingName in DisplayNameGen()
        from existingKind in Gen.Elements(AllExistingKinds)
        from consentRecorded in Gen.Elements(true, false)
        select new GuestClaimSituation(
            ids[0], ids[1], ids[2], ids[3], targetIsActingUser, actingIsOwner,
            guestName, tier, existingName, existingKind, consentRecorded);

    /// <summary>
    /// <paramref name="count"/> pairwise-distinct, non-empty identities. The trailing byte is stamped with
    /// the index so two generated identities can never coincide, and the leading byte's low bit is set so
    /// none can be <see cref="Guid.Empty"/> — which the initiation path rejects as a validation failure
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

    private static GuestClaimSituation Control(
        ExistingMembershipKind existingKind, bool actingIsOwner, bool targetIsActingUser, bool consentRecorded) =>
        new(
            Guid.Parse("11111111-1111-1111-1111-111111111101"),
            Guid.Parse("22222222-2222-2222-2222-222222222202"),
            Guid.Parse("33333333-3333-3333-3333-333333333303"),
            Guid.Parse("44444444-4444-4444-4444-444444444404"),
            targetIsActingUser,
            actingIsOwner,
            "Control Guest",
            SkillTier.Average,
            "Control Member",
            existingKind,
            consentRecorded);
}
