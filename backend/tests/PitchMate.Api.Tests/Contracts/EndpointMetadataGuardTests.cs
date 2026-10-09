namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The Endpoint_Metadata_Guard — the durable guard of Requirement 3.
/// <para>
/// <b>Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.8</b>
/// </para>
/// <para>
/// This guard exists for a future endpoint, not for today's. A test that checked off a list of 67 known
/// routes would prove only that one pass of declarations was complete; it would pass unchanged the day
/// someone maps route 68 with nothing but <c>.WithName(...)</c>, which is exactly how the surface
/// arrived at the state this chore is undoing — 66 operations all declaring a bare <c>200</c> with no
/// content. So the quantification runs over what the <i>host</i> mapped
/// (<see cref="MappedEndpointCatalogue"/>), and the only hand-maintained lists in the file are the two
/// exception lists below — the two-route stats exception and the seven-route anonymous-auth
/// exception — each held to its own size and shape by its own test
/// (<see cref="TheStatsExceptionListsExactlyTheTwoStatsRoutes"/>, Requirement 3.4, and
/// <see cref="TheAnonymousAuthExceptionListsExactlyTheSevenPublicAuthRoutes"/>).
/// </para>
/// <para>
/// Three rules are asserted, each over every discovered endpoint:
/// </para>
/// <list type="number">
/// <item><b>A declared success.</b> Every endpoint declares a 2xx — a body type where its success
/// carries a body, <c>204</c> with no body type where it does not (Requirement 3.2).</item>
/// <item><b>The <c>401</c> correspondence.</b> Every guarded endpoint declares <c>401</c>, unless its
/// route is one of the two stats routes, where a missing token is answered by the concealed <c>404</c>
/// instead and a declared <c>401</c> would itself be the tell (Requirements 3.3, 5.4).</item>
/// <item><b>No framework challenge on an anonymous endpoint.</b> An endpoint reachable without a token
/// declares neither <c>401</c> nor <c>403</c> (Requirement 2.9) — excepting the seven public auth
/// routes listed in <see cref="AnonymousAuthRoutesEmittingDomainAuthStatuses"/>, whose error seam
/// genuinely returns those statuses as the endpoint's own outcome rather than as a gate.</item>
/// </list>
/// <para>
/// Each rule reports <i>every</i> offender in one message rather than stopping at the first, because
/// the message is the worklist: a declaration pass wants the whole remaining surface, not one route at
/// a time. Offenders are named by route and method, and by the offending status where a status is what
/// is wrong.
/// </para>
/// <para>
/// Composition of a particular error seam's convention is not this guard's subject — that belongs to
/// the seam-coverage guard in <see cref="SeamCoverageProperties"/>. This one speaks only about what
/// each endpoint declares.
/// </para>
/// </summary>
public sealed class EndpointMetadataGuardTests : IClassFixture<MappedEndpointCatalogue>
{
    /// <summary>
    /// The explicit stats exception (Requirement 3.4). These two reads are existence-concealing and are
    /// deliberately <i>not</i> guarded by <c>RequireAuthorization()</c>: a missing, malformed or expired
    /// token resolves to no subject and the endpoint answers the same byte-for-byte <c>404</c> as a
    /// squad that does not exist. Declaring <c>401</c> on them would reintroduce the distinction the
    /// concealment exists to remove, so the absence is intended and is listed here rather than inferred.
    /// <para>
    /// Written out in full, in source, so widening the exception is a visible edit to this list — and
    /// one the size assertion below refuses.
    /// </para>
    /// </summary>
    internal static readonly IReadOnlyList<string> StatsRoutesExemptFromDeclaredUnauthorized =
    [
        "/squads/{squadId:guid}/leaderboard",
        "/squads/{squadId:guid}/members/{membershipId:guid}/profile",
    ];

    /// <summary>
    /// The explicit anonymous-auth exception to the authorisation-status prohibition.
    /// <para>
    /// Requirement 2.9 says an anonymous endpoint declares neither <c>401</c> nor <c>403</c>, and the
    /// reason it says so is disclosure: an endpoint with no gate must not advertise the framework's
    /// authentication challenge, or the declared status set itself tells a caller a gate exists where
    /// none does. These seven auth routes are a different case. They are anonymous and they genuinely
    /// answer <c>401</c> and <c>403</c> as their <i>own</i> outcome, from the
    /// <see cref="PitchMate.Api.Auth.Endpoints.AuthErrorResults"/> table rather than from the
    /// authorisation middleware: bad credentials on sign-in is
    /// <c>AuthenticationFailed</c> → <c>401</c>, and an unverified account is
    /// <c>EmailNotVerified</c> → <c>403</c>. A domain status the endpoint really returns is a contract
    /// the client needs; suppressing it would type sign-in's commonest failure as <c>unknown</c> for
    /// the sake of a rule aimed at something else.
    /// </para>
    /// <para>
    /// So the prohibition is narrowed to the framework challenge rather than weakened: it still holds
    /// unconditionally for every anonymous endpoint outside this list — notably the anonymous invite
    /// preview, which has no error-seam <c>401</c>/<c>403</c> of its own and must declare neither.
    /// Written out in full, in source, and held to its size and shape by
    /// <see cref="TheAnonymousAuthExceptionListsExactlyTheSevenPublicAuthRoutes"/>, so the exception
    /// cannot widen unnoticed.
    /// </para>
    /// </summary>
    internal static readonly IReadOnlyList<string> AnonymousAuthRoutesEmittingDomainAuthStatuses =
    [
        "/auth/register",
        "/auth/sign-in",
        "/auth/sign-in/google",
        "/auth/refresh",
        "/auth/password-reset/request",
        "/auth/password-reset/redeem",
        "/auth/email/verification/redeem",
    ];

    /// <summary>
    /// The non-vacuity floor (Requirement 3.8): the 66 operations the committed document already
    /// describes, plus <c>GET /auth/me</c>. A change to endpoint discovery that found fewer has to fail
    /// here rather than pass quietly over a short — or empty — set.
    /// </summary>
    private const int MinimumMappedEndpointCount = 67;

    private readonly MappedEndpointCatalogue _catalogue;

    /// <summary>Receives the shared catalogue of endpoints read off the running host.</summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    public EndpointMetadataGuardTests(MappedEndpointCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        _catalogue = catalogue;
    }

    /// <summary>
    /// Requirement 3.2 — every mapped endpoint declares a 2xx response, and each 2xx it declares states
    /// a body type unless it is <c>204</c>, which must state none.
    /// <para>
    /// The two halves are one rule: an endpoint with no 2xx at all generates as <c>unknown</c> on the
    /// client, and a <c>200</c> declared without a type generates as <c>unknown</c> just as surely while
    /// looking declared. A <c>204</c> carrying a body type is the same mistake in reverse.
    /// </para>
    /// <para>
    /// The rule itself lives in <see cref="SuccessDeclarationRule"/> rather than inline here, because
    /// <see cref="EndpointSuccessDeclarationProperties"/> has to apply the <i>same</i> predicate to
    /// synthesised endpoints that break it in order to show it has teeth. Two copies of the rule could
    /// drift, and the looser copy would be the one that stayed green.
    /// </para>
    /// </summary>
    [Fact]
    public void EveryMappedEndpointDeclaresItsSuccessResponse()
    {
        IReadOnlyList<string> failures = SuccessDeclarationRule.Violations(_catalogue.Endpoints);

        Assert.True(failures.Count == 0, Report("undeclared success responses", failures));
    }

    /// <summary>
    /// Requirements 3.3 and 3.4 — every endpoint behind <c>RequireAuthorization()</c> declares
    /// <c>401</c>, excepting only the two routes named in
    /// <see cref="StatsRoutesExemptFromDeclaredUnauthorized"/>.
    /// <para>
    /// The rule itself lives in <see cref="AuthorizationDeclarationRule"/> rather than inline here,
    /// because <see cref="AuthorizationDeclarationProperties"/> has to apply the <i>same</i> predicate
    /// to synthesised endpoints that break it in order to show it has teeth. The exception list stays
    /// here and is handed to the rule, so the list the rule honours is the one
    /// <see cref="TheStatsExceptionListsExactlyTheTwoStatsRoutes"/> pins.
    /// </para>
    /// </summary>
    [Fact]
    public void EveryAuthorisedEndpointDeclaresUnauthorized()
    {
        IReadOnlyList<string> failures = AuthorizationDeclarationRule.AuthorisedEndpointsMissingUnauthorized(
            _catalogue.Endpoints,
            StatsRoutesExemptFromDeclaredUnauthorized);

        Assert.True(failures.Count == 0, Report("authorised endpoints missing 401", failures));
    }

    /// <summary>
    /// Requirement 2.9 — an endpoint reachable without a token declares neither <c>401</c> nor
    /// <c>403</c>, so the declared status set does not advertise a gate that is not there.
    /// <para>
    /// The rule is about the <i>framework challenge</i>, not about the number. An anonymous endpoint
    /// must not advertise an authentication gate it does not have; but a domain <c>401</c> or
    /// <c>403</c> that the endpoint genuinely returns as its own outcome — sign-in refusing bad
    /// credentials, an unverified account being refused — is a contract a client needs, and hiding it
    /// would make the commonest failure of the commonest endpoint untyped. So the prohibition is
    /// narrowed, not weakened: it holds for every anonymous endpoint except the routes named in
    /// <see cref="AnonymousAuthRoutesEmittingDomainAuthStatuses"/>, whose seam really does emit those
    /// statuses.
    /// </para>
    /// <para>
    /// As with the <c>401</c> rule above, the predicate lives in
    /// <see cref="AuthorizationDeclarationRule"/> so that
    /// <see cref="AuthorizationDeclarationProperties"/> can show it rejecting an endpoint that breaks
    /// it, and the exception list stays here where
    /// <see cref="TheAnonymousAuthExceptionListsExactlyTheSevenPublicAuthRoutes"/> pins it.
    /// </para>
    /// </summary>
    [Fact]
    public void NoAnonymousEndpointDeclaresAnAuthorisationStatus()
    {
        IReadOnlyList<string> failures =
            AuthorizationDeclarationRule.AnonymousEndpointsDeclaringAuthorisationStatus(
                _catalogue.Endpoints,
                AnonymousAuthRoutesEmittingDomainAuthStatuses);

        Assert.True(failures.Count == 0, Report("anonymous endpoints declaring an authorisation status", failures));
    }

    /// <summary>
    /// Holds the anonymous-auth exception to its size and shape, exactly as
    /// <see cref="TheStatsExceptionListsExactlyTheTwoStatsRoutes"/> holds the stats one. An exception
    /// list that can grow unnoticed is how a guard stops guarding, so the list is pinned at seven
    /// entries, each entry has to name a route the host actually mapped, each has to be an
    /// <c>/auth/</c> route, and each has to be anonymous — a route that later acquires
    /// <c>RequireAuthorization()</c> stops belonging here and fails rather than sitting unused.
    /// </summary>
    [Fact]
    public void TheAnonymousAuthExceptionListsExactlyTheSevenPublicAuthRoutes()
    {
        Assert.Equal(7, AnonymousAuthRoutesEmittingDomainAuthStatuses.Count);
        Assert.Equal(
            AnonymousAuthRoutesEmittingDomainAuthStatuses.Count,
            AnonymousAuthRoutesEmittingDomainAuthStatuses.Distinct(StringComparer.Ordinal).Count());

        foreach (string route in AnonymousAuthRoutesEmittingDomainAuthStatuses)
        {
            Assert.StartsWith("/auth/", route, StringComparison.Ordinal);

            Assert.Contains(
                _catalogue.Endpoints,
                endpoint => string.Equals(endpoint.Route, route, StringComparison.Ordinal)
                    && endpoint.IsAnonymous);
        }
    }

    /// <summary>
    /// Requirement 3.4 — the stats exception stays the two stats routes. It is the one hand-maintained
    /// list in this guard, and an exception list that can grow unnoticed is how a guard stops guarding:
    /// adding a route to it would silently excuse that route from the <c>401</c> rule. So the list is
    /// pinned at two entries, each entry has to name a route the host actually mapped, and each has to
    /// be a stats read.
    /// </summary>
    [Fact]
    public void TheStatsExceptionListsExactlyTheTwoStatsRoutes()
    {
        Assert.Equal(2, StatsRoutesExemptFromDeclaredUnauthorized.Count);
        Assert.Equal(
            StatsRoutesExemptFromDeclaredUnauthorized.Count,
            StatsRoutesExemptFromDeclaredUnauthorized.Distinct(StringComparer.Ordinal).Count());

        foreach (string route in StatsRoutesExemptFromDeclaredUnauthorized)
        {
            Assert.Contains(
                _catalogue.Endpoints,
                endpoint => string.Equals(endpoint.Route, route, StringComparison.Ordinal));

            Assert.StartsWith("/squads/", route, StringComparison.Ordinal);
        }

        Assert.Contains(
            "leaderboard",
            StatsRoutesExemptFromDeclaredUnauthorized.Select(static route => route.Split('/')[^1]));
        Assert.Contains(
            "profile",
            StatsRoutesExemptFromDeclaredUnauthorized.Select(static route => route.Split('/')[^1]));
    }

    /// <summary>
    /// Requirement 3.8 — the discovery floor. Without it every assertion above would be satisfied by an
    /// empty set, which is precisely what a change to how endpoints are enumerated would produce: the
    /// guard would go green at the moment it stopped looking at anything.
    /// <para>
    /// At least 67 endpoints, every one with a route and a concrete HTTP method, and every subsystem
    /// present — so a discovery regression that lost a whole route group fails here too.
    /// </para>
    /// </summary>
    [Fact]
    public void TheDiscoveredEndpointSurfaceIsNonVacuous()
    {
        Assert.True(
            _catalogue.Endpoints.Count >= MinimumMappedEndpointCount,
            $"Endpoint discovery found {_catalogue.Endpoints.Count} endpoints; "
                + $"at least {MinimumMappedEndpointCount} are mapped. "
                + "A guard that enumerates nothing passes everything.");

        Assert.All(_catalogue.Endpoints, endpoint =>
        {
            Assert.StartsWith("/", endpoint.Route, StringComparison.Ordinal);
            Assert.NotEqual("(any)", endpoint.Method);
        });

        // Every subsystem of the surface is represented, so losing one route group is a failure here
        // rather than a quietly smaller set for the rules above to range over.
        foreach (string routePrefix in (string[])["/health", "/auth/", "/squads/", "/matches/", "/notifications"])
        {
            Assert.Contains(
                _catalogue.Endpoints,
                endpoint => endpoint.Route.StartsWith(routePrefix, StringComparison.Ordinal));
        }
    }

    /// <summary>
    /// Renders every offender in one message. The guard's output is a worklist, so it names all of them
    /// rather than shrinking to the first.
    /// </summary>
    private static string Report(string subject, IReadOnlyList<string> failures) =>
        $"{failures.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, failures.Select(static failure => $"  - {failure}"));
}
