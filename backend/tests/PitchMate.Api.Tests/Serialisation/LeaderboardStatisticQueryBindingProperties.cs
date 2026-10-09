using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Api.Stats.Endpoints;
using PitchMate.Api.Tests.Auth;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Stats;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// The guard for <b>Property 9 — The leaderboard statistic parameter keeps its case-insensitive by-name
/// binding</b>.
/// <para>
/// <b>Validates: Requirement 4.6</b>
/// </para>
/// <para>
/// The <c>statistic</c> query parameter is <em>not</em> bound by the JSON pipeline. It arrives as a
/// <see cref="string"/> and is turned into a <see cref="LeaderboardStatistic"/> by the endpoint's own
/// helper, using <c>Enum.TryParse(..., ignoreCase: true)</c> guarded by <c>Enum.IsDefined</c>. Registering
/// the wire JSON contract therefore has no business changing it — and this guard is what says so out
/// loud, so a later attempt to "unify" the two paths (for instance by binding the parameter as the enum
/// type and inheriting the body contract's case-sensitive, integer-rejecting rules) fails here rather
/// than silently narrowing a query vocabulary clients already use.
/// </para>
/// <para>
/// Two levels are asserted, because the binding has two levels. The property below drives the parsing
/// helper itself over arbitrary casing permutations of every member name, drawn by reflection over the
/// enum so a member added later is covered without this file being edited. The theories after it drive
/// the same casings through the real host end to end, so the property is anchored to the surface a
/// client actually calls rather than to a helper that some future edit might stop calling.
/// </para>
/// <para>
/// The end-to-end half needs care: the stats seam conceals an authorisation failure as a <c>404</c>, and
/// <c>GetLeaderboardHandler</c> runs its active-member gate <em>before</em> it looks at the statistic. A
/// request whose membership does not resolve would answer <c>404</c> for every casing, passing or failing
/// for reasons that have nothing to do with binding. The host is therefore given an
/// <see cref="ActiveMemberOnlyMembershipRepository"/> so the gate passes, and
/// <see cref="EndToEnd_AnUnrecognisedStatisticIsRejected"/> proves the resulting <c>200</c>s are load
/// bearing: on this same host an unrecognised statistic reaches the handler's supported-set check and
/// answers <c>400</c>, so a <c>200</c> means the name bound and nothing else.
/// </para>
/// </summary>
public sealed class LeaderboardStatisticQueryBindingProperties : IClassFixture<AuthApiFactory>, IDisposable
{
    /// <summary>The one caller whose membership resolves on the stubbed host.</summary>
    private static readonly Guid RequestingUserId = Guid.CreateVersion7();

    /// <summary>The one squad the caller is an active member of on the stubbed host.</summary>
    private static readonly Guid SquadId = Guid.CreateVersion7();

    /// <summary>
    /// The endpoint's own query-to-enum parsing helper, located by reflection because it is a private
    /// implementation detail of <see cref="StatsEndpoints"/>. Testing it directly is deliberate: it is
    /// where the case-insensitive by-name binding actually lives, so this is the unit whose behaviour
    /// Requirement 4.6 pins.
    /// </summary>
    private static readonly MethodInfo ParseStatisticMethod =
        typeof(StatsEndpoints).GetMethod("ParseStatistic", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new InvalidOperationException(
            "StatsEndpoints no longer declares a private static ParseStatistic helper. The leaderboard "
                + "'statistic' query parameter must keep its case-insensitive by-name binding "
                + "(Requirement 4.6); point this guard at whatever now performs that bind.");

    private readonly WebApplicationFactory<Program> _host;
    private readonly HttpClient _client;
    private readonly string _bearerToken;

    /// <summary>
    /// Boots the real Api on top of the shared <see cref="AuthApiFactory"/> configuration, replacing only
    /// the two repositories the leaderboard read touches so no database is required.
    /// </summary>
    /// <param name="factory">The shared in-memory Api host factory.</param>
    public LeaderboardStatisticQueryBindingProperties(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        _host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ISquadMembershipRepository>();
                services.AddSingleton<ISquadMembershipRepository>(
                    new ActiveMemberOnlyMembershipRepository(RequestingUserId, SquadId));

                services.RemoveAll<IStatsRepository>();
                services.AddSingleton<IStatsRepository, EmptyLeaderboardStatsRepository>();
            }));

        _client = _host.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        _bearerToken = TestAccessTokens.ValidToken(RequestingUserId);
    }

    /// <summary>Every member name of the statistic enum, as reflection reports it.</summary>
    public static TheoryData<string> MemberNames()
    {
        var data = new TheoryData<string>();

        foreach (string name in Enum.GetNames<LeaderboardStatistic>())
        {
            data.Add(name);
        }

        return data;
    }

    /// <summary>
    /// Every member name paired with each of four fixed casings — verbatim, all-lower, all-upper, and
    /// inverted — for the exhaustive end-to-end theory. Fixed rather than random so a failure names the
    /// exact casing that regressed.
    /// </summary>
    public static TheoryData<string, string> MemberNamesWithFixedCasings()
    {
        var data = new TheoryData<string, string>();

        foreach (string name in Enum.GetNames<LeaderboardStatistic>())
        {
            foreach (string cased in FixedCasings(name))
            {
                data.Add(name, cased);
            }
        }

        return data;
    }

    // Feature: api-response-contracts, Property 9: The leaderboard statistic parameter keeps its
    // case-insensitive by-name binding.
    // Validates: Requirement 4.6
    [Property(MaxTest = 500, Arbitrary = new[] { typeof(CasedStatisticNameGenerators) })]
    public Property Property9_TheStatisticParameterKeepsItsCaseInsensitiveByNameBinding(CasedStatisticName cased)
    {
        ArgumentNullException.ThrowIfNull(cased);

        LeaderboardStatistic bound = Bind(cased.Cased);

        // The oracle is independent of the implementation: the member the casing names is the one whose
        // own name matches it ignoring case. Nothing here re-uses Enum.TryParse.
        LeaderboardStatistic expected = Enum.GetValues<LeaderboardStatistic>()
            .Single(member => string.Equals(member.ToString(), cased.Cased, StringComparison.OrdinalIgnoreCase));

        return (bound == expected && bound == cased.Member)
            .ToProperty()
            .Label($"'{cased.Cased}' bound to {bound}; expected {expected} (canonically {cased.Member})")
            .Collect(cased.Member);
    }

    /// <summary>
    /// The verbatim member name binds to its own member — the baseline the casing permutations are
    /// permutations of.
    /// </summary>
    [Theory]
    [MemberData(nameof(MemberNames))]
    public void TheVerbatimMemberNameBindsToThatMember(string name)
    {
        Assert.Equal(Enum.Parse<LeaderboardStatistic>(name), Bind(name));
    }

    /// <summary>
    /// The same four fixed casings through the real host: each answers <c>200</c> with a body reporting
    /// the member the name denotes, so the binding holds on the surface a client calls and not merely in
    /// the helper.
    /// </summary>
    [Theory]
    [MemberData(nameof(MemberNamesWithFixedCasings))]
    public async Task EndToEnd_EveryCasingOfAMemberNameBindsToThatMember(string name, string cased)
    {
        var expected = Enum.Parse<LeaderboardStatistic>(name);

        (HttpStatusCode status, string body) = await GetLeaderboardAsync(cased);

        Assert.True(
            status == HttpStatusCode.OK,
            $"'{cased}' answered {(int)status} rather than 200. A 404 here means the authorisation gate, "
                + $"not the binding. Body: {body}");
        Assert.Equal(expected, ReadStatistic(body));
    }

    /// <summary>
    /// The non-vacuity anchor for the end-to-end theory. On this very host — same membership, same
    /// token — a value that names no member reaches the handler's supported-set check and is rejected
    /// with <c>400</c>, not concealed as <c>404</c>. So the <c>200</c>s above are reporting a successful
    /// bind rather than a uniformly permissive surface, and a <c>404</c> in this suite would mean the
    /// authorisation gate, not the binding.
    /// </summary>
    [Theory]
    [InlineData("NotAStatistic")]
    [InlineData("win_percentage")]
    [InlineData("")]
    [InlineData(null)]
    public async Task EndToEnd_AnUnrecognisedStatisticIsRejected(string? cased)
    {
        (HttpStatusCode status, _) = await GetLeaderboardAsync(cased);

        Assert.Equal(HttpStatusCode.BadRequest, status);
    }

    /// <summary>
    /// The registration this whole file is a guard against disturbing is in fact in force on the host
    /// under test — the leaderboard body reports its statistic as a name, not as an integer. Without
    /// this, the suite could pass on a host where the wire JSON contract had silently gone missing.
    /// </summary>
    [Fact]
    public async Task EndToEnd_TheBoundStatisticIsReportedBackAsAName()
    {
        (HttpStatusCode status, string body) = await GetLeaderboardAsync(nameof(LeaderboardStatistic.WinPercentage));

        Assert.Equal(HttpStatusCode.OK, status);

        using JsonDocument document = JsonDocument.Parse(body);
        JsonElement statistic = document.RootElement.GetProperty("statistic");

        Assert.Equal(JsonValueKind.String, statistic.ValueKind);
        Assert.Equal(nameof(LeaderboardStatistic.WinPercentage), statistic.GetString());
    }

    /// <summary>
    /// The non-vacuity floor for the property's input space: the generator draws from every member the
    /// enum declares, and the helper the property drives really does reject an unknown name (so the
    /// property is not passing because everything binds to something).
    /// </summary>
    [Fact]
    public void TheGeneratedMemberSetCoversEveryDeclaredMemberAndAnUnknownNameBindsToNoMember()
    {
        Assert.Equal(
            Enum.GetValues<LeaderboardStatistic>().Length,
            CasedStatisticNameGenerators.MemberNames.Count);

        Assert.Equal(
            Enum.GetNames<LeaderboardStatistic>().Order(StringComparer.Ordinal),
            CasedStatisticNameGenerators.MemberNames.Order(StringComparer.Ordinal));

        Assert.False(Enum.IsDefined(Bind("NotAStatistic")));
        Assert.False(Enum.IsDefined(Bind(null)));
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _client.Dispose();
        _host.Dispose();
    }

    /// <summary>
    /// The four fixed casings of <paramref name="name"/> the end-to-end theory drives: verbatim,
    /// all-lower, all-upper, and inverted (every character's case flipped), de-duplicated.
    /// </summary>
    private static IEnumerable<string> FixedCasings(string name) =>
        new[]
        {
            name,
            name.ToLowerInvariant(),
            name.ToUpperInvariant(),
            new string(name
                .Select(character =>
                    char.IsUpper(character) ? char.ToLowerInvariant(character) : char.ToUpperInvariant(character))
                .ToArray()),
        }
        .Distinct(StringComparer.Ordinal);

    /// <summary>Invokes the endpoint's private query-to-enum helper with <paramref name="raw"/>.</summary>
    private static LeaderboardStatistic Bind(string? raw) =>
        (LeaderboardStatistic)ParseStatisticMethod.Invoke(null, [raw])!;

    /// <summary>Reads the <c>statistic</c> member of a leaderboard body back as its enum member.</summary>
    private static LeaderboardStatistic ReadStatistic(string body)
    {
        using JsonDocument document = JsonDocument.Parse(body);
        string? name = document.RootElement.GetProperty("statistic").GetString();

        return Enum.Parse<LeaderboardStatistic>(name!);
    }

    /// <summary>
    /// Issues an authenticated leaderboard read for the stubbed squad, passing
    /// <paramref name="statistic"/> as the <c>statistic</c> query value, or omitting the parameter
    /// entirely when it is <see langword="null"/>.
    /// </summary>
    private async Task<(HttpStatusCode Status, string Body)> GetLeaderboardAsync(string? statistic)
    {
        string path = $"/squads/{SquadId}/leaderboard";
        if (statistic is not null)
        {
            path += $"?statistic={Uri.EscapeDataString(statistic)}";
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bearerToken);

        using HttpResponseMessage response = await _client.SendAsync(request);

        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }
}

/// <summary>
/// One generated case: a statistic member together with one arbitrary casing permutation of its name.
/// </summary>
/// <param name="Member">The member the name denotes, whatever its casing.</param>
/// <param name="Cased">The member's name with an arbitrary per-character casing applied.</param>
public sealed record CasedStatisticName(LeaderboardStatistic Member, string Cased)
{
    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{Member} as '{Cased}'";
}

/// <summary>
/// FsCheck arbitraries for <see cref="CasedStatisticName"/>. Members come from
/// <see cref="Enum.GetNames{TEnum}()"/>, so the input space is exactly what the enum declares and grows
/// on its own when a statistic is added (Requirement 4.9's reflection discipline, applied to the query
/// path). The casing is drawn as a bitmask over the name's characters, which reaches every one of the
/// 2^length permutations for the longest member name (14 characters) rather than only the obvious
/// all-upper / all-lower cases.
/// </summary>
public static class CasedStatisticNameGenerators
{
    /// <summary>The member names the generator draws from, as reflection reports them.</summary>
    public static IReadOnlyList<string> MemberNames { get; } = Enum.GetNames<LeaderboardStatistic>();

    /// <summary>Arbitrary for a statistic member name under an arbitrary casing.</summary>
    public static Arbitrary<CasedStatisticName> CasedStatisticName() => Arb.From(CasedNameGen());

    private static Gen<CasedStatisticName> CasedNameGen() =>
        from name in Gen.Elements(MemberNames.ToArray())
        from mask in Gen.Choose(0, (1 << name.Length) - 1)
        select new CasedStatisticName(Enum.Parse<LeaderboardStatistic>(name), ApplyCasing(name, mask));

    /// <summary>
    /// Renders <paramref name="name"/> with the case of each character decided by the corresponding bit
    /// of <paramref name="mask"/> — set for upper, clear for lower.
    /// </summary>
    private static string ApplyCasing(string name, int mask) =>
        new(name
            .Select((character, index) =>
                (mask & (1 << index)) != 0
                    ? char.ToUpperInvariant(character)
                    : char.ToLowerInvariant(character))
            .ToArray());
}
