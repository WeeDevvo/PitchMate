using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
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
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Tests.Auth;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// The backend conjunct of <b>Property 14 — A named envelope preserves the value it wraps, end to end</b>.
/// <para>
/// <b>Validates: Requirements 7.1, 7.2, 7.4, 7.6, 12.10</b>
/// </para>
/// <para>
/// The three endpoints of design D6 used to answer with a shape no schema could describe: two bare JSON
/// numbers and one anonymous type. Each now answers with a named transport record. This guard asserts the
/// two halves of that claim together, because either alone is satisfiable by a wrong implementation: the
/// body is an <i>object</i> naming its value (so it is not the bare number it was, and a field can be
/// added later without breaking a client), <b>and</b> the value under that name is exactly the one the
/// use case reported (so the envelope is a wrapper and not a transformation — Requirement 7.4).
/// </para>
/// <para>
/// It is asserted through the real Api host, so the property speaks about the shape that actually reaches
/// a client: the route, the authenticated caller, the real Application handler, and the configured
/// minimal-API serialiser. Two services are substituted so that <i>any</i> non-negative count the use
/// case could report is reachable without a database — the notification read surface
/// (<see cref="StubbedCountNotificationRepository"/>, which reports the count the test asks for) and the
/// unit of work (<see cref="NoOpUnitOfWork"/>, which the mark-all-read handler commits through after the
/// count it reports is already settled). Nothing that shapes the envelope is stubbed.
/// </para>
/// <para>
/// The expected wire member names are derived from the records' own property names through the host's
/// configured naming policy rather than spelled out, so the guard follows a rename of either side
/// instead of going quietly stale — and the non-vacuity fact pins what that derivation currently yields.
/// </para>
/// <para>
/// The web conjunct of this property — that <c>countParsing.ts</c> recovers exactly that value from that
/// body — is re-asserted by the app-shell migration against the same shape.
/// </para>
/// </summary>
public sealed class NamedEnvelopeProperties : IClassFixture<AuthApiFactory>
{
    /// <summary>The caller stamped on the forged access token. It backs no membership, and never needs to.</summary>
    private static readonly Guid CallerId = Guid.Parse("6a3f8c25-9d41-4b7e-8c02-1f5e3a9d7b64");

    private const string UnreadCountRoute = "/notifications/unread-count";
    private const string MarkAllReadRoute = "/notifications/read-all";
    private const string HealthRoute = "/health";

    private readonly StubbedCountNotificationRepository _notifications = new();
    private readonly JsonSerializerOptions _options;
    private readonly HttpClient _client;
    private readonly string _bearer;

    /// <summary>
    /// Boots the real Api once for the class with the two substitutions described above, and resolves the
    /// JSON options from that same host so the expected member names come from the registration the
    /// endpoints actually serialise through.
    /// </summary>
    /// <param name="factory">The shared Api host factory, supplying the test configuration and clock.</param>
    public NamedEnvelopeProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<INotificationRepository>();
                services.AddSingleton<INotificationRepository>(_notifications);
                services.RemoveAll<IUnitOfWork>();
                services.AddSingleton<IUnitOfWork>(new NoOpUnitOfWork());
            }));

        _client = host.CreateClient();
        _options = host.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;
        _bearer = TestAccessTokens.ValidToken(CallerId);
    }

    // Feature: api-response-contracts, Property 14: A named envelope preserves the value it wraps, end to end.
    // Validates: Requirements 7.1, 7.2, 7.4, 7.6, 12.10
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(NamedEnvelopeGenerators) })]
    public Property Property14_TheUnreadCountEnvelopeNamesTheCountTheUseCaseReported(ReportedUnreadCount count)
    {
        ArgumentNullException.ThrowIfNull(count);

        _notifications.UnreadCount = count.Value;

        IReadOnlyList<string> failures = NamedNumberFailures(
            Send(HttpMethod.Get, UnreadCountRoute),
            WireName(nameof(UnreadCountResponse.Count)),
            count.Value);

        return (failures.Count == 0)
            .ToProperty()
            .Label($"unread count {count.Value}: {string.Join("; ", failures)}")
            .Classify(count.Value == 0, "zero")
            .Classify(count.Value is > 0 and < 1_000, "small")
            .Classify(count.Value >= 1_000, "large");
    }

    // Feature: api-response-contracts, Property 14: A named envelope preserves the value it wraps, end to end.
    // Validates: Requirements 7.2, 7.4, 7.6, 12.10
    [Property(MaxTest = 50, Arbitrary = new[] { typeof(NamedEnvelopeGenerators) })]
    public Property Property14_TheMarkAllReadEnvelopeNamesTheCountTheUseCaseReported(FlippedRecordCount flipped)
    {
        ArgumentNullException.ThrowIfNull(flipped);

        // The mark-all-read count is the number of records the handler flipped, so the count under test
        // is produced by handing it that many unread records rather than by asserting a number.
        _notifications.UnreadRecordCount = flipped.Value;

        IReadOnlyList<string> failures = NamedNumberFailures(
            Send(HttpMethod.Post, MarkAllReadRoute),
            WireName(nameof(MarkAllReadResponse.MarkedCount)),
            flipped.Value);

        return (failures.Count == 0)
            .ToProperty()
            .Label($"marked count {flipped.Value}: {string.Join("; ", failures)}")
            .Classify(flipped.Value == 0, "nothing to mark")
            .Classify(flipped.Value > 0, "records flipped");
    }

    /// <summary>
    /// The third envelope of D6. The liveness probe carries no varying value, so its conjunct is a
    /// companion assertion rather than a property: the body is an object naming its status, not the
    /// anonymous type it was (Requirements 7.3, 7.4).
    /// </summary>
    [Fact]
    public void TheHealthEnvelopeNamesItsStatus()
    {
        WireBodyFacts facts = Send(HttpMethod.Get, HealthRoute, authenticated: false);

        Assert.Equal(StatusCodes.Status200OK, facts.Status);

        using JsonDocument document = JsonDocument.Parse(facts.RawBody);
        JsonElement root = document.RootElement;

        Assert.Equal(JsonValueKind.Object, root.ValueKind);
        Assert.Single(root.EnumerateObject());

        JsonElement status = root.GetProperty(WireName(nameof(HealthResponse.Status)));
        Assert.Equal(JsonValueKind.String, status.ValueKind);
        Assert.Equal("ok", status.GetString());
    }

    /// <summary>
    /// The non-vacuity floor. Without it both properties could pass against an endpoint that answers a
    /// constant, or against member names the derivation had quietly stopped producing.
    /// <list type="bullet">
    /// <item>The derived wire names are the ones a client reads, pinned literally — so a naming-policy
    /// change is a visible failure here rather than a silently weakened assertion above.</item>
    /// <item>A spread of counts, including the boundary <c>0</c> and the widest value the member can
    /// carry, each produce a <i>distinct</i> body: the envelope tracks the stubbed value rather than the
    /// properties agreeing with a constant.</item>
    /// <item>The same holds for the mark-all-read conjunct across its own range, so that property is not
    /// passing over a single record count either.</item>
    /// </list>
    /// </summary>
    [Fact]
    public void TheNamedEnvelopeSurfaceIsNonVacuous()
    {
        Assert.Equal("count", WireName(nameof(UnreadCountResponse.Count)));
        Assert.Equal("markedCount", WireName(nameof(MarkAllReadResponse.MarkedCount)));
        Assert.Equal("status", WireName(nameof(HealthResponse.Status)));

        int[] counts = [0, 1, 2, 7, 1_000, int.MaxValue];
        var countBodies = new List<string>();

        foreach (int count in counts)
        {
            _notifications.UnreadCount = count;
            WireBodyFacts facts = Send(HttpMethod.Get, UnreadCountRoute);

            Assert.Empty(NamedNumberFailures(facts, "count", count));
            countBodies.Add(facts.RawBody);
        }

        Assert.Equal(counts.Length, countBodies.Distinct(StringComparer.Ordinal).Count());

        int[] flipped = [0, 1, NamedEnvelopeGenerators.MaxFlippedRecords];
        var flippedBodies = new List<string>();

        foreach (int records in flipped)
        {
            _notifications.UnreadRecordCount = records;
            WireBodyFacts facts = Send(HttpMethod.Post, MarkAllReadRoute);

            Assert.Empty(NamedNumberFailures(facts, "markedCount", records));
            flippedBodies.Add(facts.RawBody);
        }

        Assert.Equal(flipped.Length, flippedBodies.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// Everything that would make an envelope fail to be "an object whose named member equals that
    /// value", as a list of readable reasons — empty when the body is exactly that. Collected rather than
    /// thrown so a shrunk counterexample reports what the body was.
    /// </summary>
    private static IReadOnlyList<string> NamedNumberFailures(WireBodyFacts facts, string member, int expected)
    {
        var failures = new List<string>();

        if (facts.Status != StatusCodes.Status200OK)
        {
            failures.Add($"answered {facts.Status} with '{facts.RawBody}'");
            return failures;
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

            // The envelope claim itself: an object, not the bare JSON number this endpoint used to answer.
            if (root.ValueKind != JsonValueKind.Object)
            {
                failures.Add($"body is a {root.ValueKind}, not an object: '{facts.RawBody}'");
                return failures;
            }

            // One member, so the value is named unambiguously and the object is the envelope of D6
            // rather than some larger body that happens to contain the count.
            int memberCount = root.EnumerateObject().Count();
            if (memberCount != 1)
            {
                failures.Add($"body carries {memberCount} members rather than one: '{facts.RawBody}'");
            }

            if (!root.TryGetProperty(member, out JsonElement value))
            {
                failures.Add($"body carries no '{member}' member: '{facts.RawBody}'");
                return failures;
            }

            // The preservation claim: the named member is the number the use case reported, unchanged.
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out int carried))
            {
                failures.Add($"'{member}' is a {value.ValueKind}, not a 32-bit number: '{facts.RawBody}'");
            }
            else if (carried != expected)
            {
                failures.Add(
                    $"'{member}' carries {carried.ToString(CultureInfo.InvariantCulture)} rather than "
                        + expected.ToString(CultureInfo.InvariantCulture));
            }
        }

        return failures;
    }

    /// <summary>The wire name of a response member under the host's configured naming policy.</summary>
    private string WireName(string clrMemberName) =>
        _options.PropertyNamingPolicy?.ConvertName(clrMemberName) ?? clrMemberName;

    private WireBodyFacts Send(HttpMethod method, string route, bool authenticated = true)
    {
        using var request = new HttpRequestMessage(method, route);
        if (authenticated)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bearer);
        }

        using HttpResponseMessage response = _client.SendAsync(request).GetAwaiter().GetResult();
        string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

        return new WireBodyFacts((int)response.StatusCode, body);
    }
}

/// <summary>The parts of a response this guard reasons about: the status, and the body verbatim.</summary>
/// <param name="Status">The HTTP status code.</param>
/// <param name="RawBody">The response body exactly as it crossed the wire.</param>
public sealed record WireBodyFacts(int Status, string RawBody);

/// <summary>
/// A non-negative unread count the read model reports. Any <see cref="int"/> is reachable, because the
/// count is whatever the repository counts.
/// </summary>
/// <param name="Value">The count reported.</param>
public sealed record ReportedUnreadCount(int Value);

/// <summary>
/// A number of the caller's own unread records, which is the count the mark-all-read use case reports.
/// Bounded, because producing this count means materialising that many records.
/// </summary>
/// <param name="Value">The number of records flipped.</param>
public sealed record FlippedRecordCount(int Value);

/// <summary>
/// FsCheck arbitraries for the two counts. Both are biased towards the values that would actually break
/// an envelope: <c>0</c>, which is where a "truthy count" or an omitted-default member would go wrong;
/// small counts, which is what a client sees day to day; and — for the unread count, whose value is not
/// bounded by anything the handler materialises — the top of the <see cref="int"/> range, where a body
/// that narrowed the number on the way out would show.
/// </summary>
public static class NamedEnvelopeGenerators
{
    /// <summary>
    /// The largest number of records the mark-all-read conjunct materialises. Small on purpose: the
    /// count is produced by real domain records, and the envelope's behaviour does not vary with size.
    /// </summary>
    public const int MaxFlippedRecords = 64;

    /// <summary>Arbitrary for an unread count the read model reports.</summary>
    public static Arbitrary<ReportedUnreadCount> ReportedUnreadCount() => Arb.From(UnreadCountGen());

    /// <summary>Arbitrary for a number of records the mark-all-read use case flips.</summary>
    public static Arbitrary<FlippedRecordCount> FlippedRecordCount() => Arb.From(FlippedRecordCountGen());

    private static Gen<ReportedUnreadCount> UnreadCountGen() =>
        from value in Gen.Frequency(
            (2, Gen.Constant(0)),
            (4, Gen.Choose(0, 50)),
            (3, Gen.Choose(0, 1_000_000)),
            (2, Gen.Choose(int.MaxValue - 4, int.MaxValue)))
        select new ReportedUnreadCount(value);

    private static Gen<FlippedRecordCount> FlippedRecordCountGen() =>
        from value in Gen.Frequency(
            (2, Gen.Constant(0)),
            (5, Gen.Choose(0, 8)),
            (2, Gen.Choose(0, MaxFlippedRecords)))
        select new FlippedRecordCount(value);
}
