using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Stats.Endpoints;
using PitchMate.Api.Tests.Auth;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The Concealing_Endpoint_Guard for <b>Property 4 — An existence-sensitive endpoint declares 404 in
/// place of 403</b>.
/// <para>
/// <b>Validates: Requirements 2.3, 5.3</b>
/// </para>
/// <para>
/// An existence-sensitive read answers an authorisation failure with <c>404</c> so a caller outside the
/// squad cannot learn whether the target exists. Requirement 5.3 extends that from the response to the
/// <i>contract</i>: the declared status set must not distinguish a non-member from a non-existent
/// target either, which means <c>404</c> is declared and <c>403</c> is absent. A declared <c>403</c> on
/// such an endpoint would hand back exactly the tell the concealment removes — and it would do so
/// silently, because the endpoint keeps behaving correctly; only the generated client would start
/// offering a branch the surface never takes.
/// </para>
/// <para>
/// <b>How a concealing endpoint is identified.</b> By the
/// <see cref="ExistenceConcealingMetadata"/> marker the concealing conventions attach, not by its
/// declared statuses. Keying off the status set was the obvious alternative and it does not work here,
/// for two reasons. First, it cannot identify the subject: the notification and live-tracking
/// concealing variants declare sets <i>identical</i> to their standard variants (their handlers and
/// seams collapse an authorisation failure into a not-found before the convention is reached), so no
/// inspection of statuses can tell one from the other. Second, and worse, it would make the rule
/// circular — an endpoint composing a concealing convention and then declaring <c>403</c> anyway would
/// no longer match the concealing set, so the guard would quietly stop regarding it as its subject and
/// pass. That endpoint is the entire reason the guard exists, which is why
/// <see cref="TheRuleFailsOnAConcealingEndpointThatAlsoDeclares403"/> synthesises precisely it. Nor is
/// "the concealing set with <c>403</c> added back" usable as a rule: for squads and matches the
/// concealing set <i>is</i> the standard set minus <c>403</c>, so that rule would misread all
/// twenty-two ordinary squad endpoints as concealing and fail them.
/// </para>
/// <para>
/// The marker therefore makes the intent a fact about the endpoint, and the quantification runs over
/// the endpoints the running host reports carrying it — never over a list in this file. A concealing
/// endpoint added next year enters the property because it composes a concealing convention, with
/// nothing here edited; the <see cref="MinimumConcealingEndpointCount"/> floor stops a detection
/// regression from turning that quantification into an empty set that satisfies everything.
/// </para>
/// <para>
/// This guard speaks only about what a concealing endpoint <i>declares</i>. That the concealed
/// responses are actually indistinguishable on the wire is the concealment guard's subject, and which
/// statuses each seam can emit is the seam-coverage guard's (<see cref="SeamCoverageProperties"/>).
/// </para>
/// </summary>
public sealed class ConcealingStatusSetProperties : IClassFixture<ConcealingEndpointCatalogue>
{
    /// <summary>
    /// The non-vacuity floor: the thirteen endpoints that compose a concealing convention today — two
    /// squad reads, two match reads, four notification routes, three live-tracking routes and the two
    /// wholly-concealing stats reads — held at eleven so the floor is a floor rather than a restatement
    /// of today's count, and so adding a concealing endpoint does not require editing this file.
    /// <para>
    /// Without it every assertion below would be satisfied by an empty set, which is exactly what a
    /// regression in marker detection would produce: the guard would go green at the moment it stopped
    /// recognising its own subject.
    /// </para>
    /// </summary>
    private const int MinimumConcealingEndpointCount = 11;

    private readonly ConcealingEndpointCatalogue _catalogue;

    /// <summary>Receives the catalogue of endpoints read off the running host.</summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    public ConcealingStatusSetProperties(ConcealingEndpointCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        _catalogue = catalogue;
    }

    /// <summary>
    /// Every concealing convention, each as a composition applied to a synthesised endpoint. Discovered
    /// by naming the five methods rather than by reflection, because a control has to be able to state
    /// what it is controlling; the <i>property</i> above quantifies over discovered endpoints and takes
    /// no notice of this list.
    /// </summary>
    private static IReadOnlyList<(string Name, Func<ConventionRecorder, ConventionRecorder> Compose)>
        ConcealingConventions =>
    [
        (nameof(SquadResponseConventions.WithSquadConcealedProblemResponses),
            static builder => builder.WithSquadConcealedProblemResponses()),
        (nameof(MatchResponseConventions.WithMatchConcealedProblemResponses),
            static builder => builder.WithMatchConcealedProblemResponses()),
        (nameof(NotificationResponseConventions.WithNotificationConcealedProblemResponses),
            static builder => builder.WithNotificationConcealedProblemResponses()),
        (nameof(LiveTrackingResponseConventions.WithLiveTrackingConcealedProblemResponses),
            static builder => builder.WithLiveTrackingConcealedProblemResponses()),
        (nameof(StatsResponseConventions.WithStatsProblemResponses),
            static builder => builder.WithStatsProblemResponses()),
    ];

    // Feature: api-response-contracts, Property 4: An existence-sensitive endpoint declares 404 in
    // place of 403 — for any endpoint composing a concealing response convention, 404 is declared and
    // 403 is absent from its declared problem set, so the declared contract distinguishes neither a
    // non-member from a non-existent target nor a concealing endpoint from a non-concealing one by
    // anything other than its status set.
    // Validates: Requirements 2.3, 5.3
    [Property(MaxTest = 200)]
    [Trait("Property", "4")]
    public Property Property4_AnExistenceSensitiveEndpointDeclares404InPlaceOf403() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(_catalogue.ConcealingEndpoints.ToArray())),
            (ConcealingEndpointFact endpoint) =>
            {
                IReadOnlyList<string> offences = Offences([endpoint]);

                return (offences.Count == 0)
                    .ToProperty()
                    .Label(string.Join("; ", offences))
                    .Collect(endpoint.Endpoint.Description);
            });

    /// <summary>
    /// The exhaustive companion to the property: the same rule over every discovered endpoint at once,
    /// reporting <i>every</i> offender in one message rather than the single shrunk counterexample a
    /// property failure yields. Each offender is named by route and method, and by the status at fault.
    /// </summary>
    [Fact]
    public void EveryConcealingEndpointDeclaresNotFoundAndNoForbidden()
    {
        IReadOnlyList<string> offences = Offences(_catalogue.Endpoints);

        Assert.True(offences.Count == 0, Report("concealing endpoints with a disclosing status set", offences));
    }

    /// <summary>
    /// Requirement 5.3's floor. At least <see cref="MinimumConcealingEndpointCount"/> endpoints are
    /// recognised as concealing; the marker is on a strict subset of the surface, so detection has not
    /// degenerated into "everything conceals"; the concealing endpoints span several route groups, so
    /// losing a whole subsystem's markers fails here rather than shrinking the set the rule ranges
    /// over; and every endpoint that does declare <c>403</c> sits outside the concealing set, which is
    /// the complement of the rule and proves the two populations are genuinely distinguished rather
    /// than merely asserted apart.
    /// </summary>
    [Fact]
    public void TheDiscoveredConcealingSurfaceIsNonVacuous()
    {
        Assert.True(
            _catalogue.ConcealingEndpoints.Count >= MinimumConcealingEndpointCount,
            $"Found {_catalogue.ConcealingEndpoints.Count} concealing endpoints among "
                + $"{_catalogue.Endpoints.Count} discovered; at least {MinimumConcealingEndpointCount} "
                + "compose a concealing convention. A guard that enumerates nothing passes everything.");

        Assert.True(
            _catalogue.ConcealingEndpoints.Count < _catalogue.Endpoints.Count,
            "Every discovered endpoint reports itself as concealing, so the marker no longer "
                + "discriminates and the rule below would be vacuous in the other direction.");

        IReadOnlyList<string> concealingRouteGroups =
        [
            .. _catalogue.ConcealingEndpoints
                .Select(static endpoint => endpoint.Endpoint.Route.Split('/')[1])
                .Distinct(StringComparer.Ordinal),
        ];

        Assert.True(
            concealingRouteGroups.Count >= 3,
            $"Concealing endpoints were found under only {concealingRouteGroups.Count} route "
                + $"group(s) ({string.Join(", ", concealingRouteGroups)}); the concealing surface spans "
                + "the squad, match and notification groups.");

        IReadOnlyList<ConcealingEndpointFact> declaringForbidden =
        [
            .. _catalogue.Endpoints
                .Where(static endpoint => endpoint.Endpoint.Declares(StatusCodes.Status403Forbidden)),
        ];

        Assert.NotEmpty(declaringForbidden);
        Assert.DoesNotContain(declaringForbidden, static endpoint => endpoint.ConcealsExistence);
    }

    /// <summary>
    /// The discriminating control for the <c>403</c> half of the rule, and the reason the marker rather
    /// than the status set identifies the subject.
    /// <para>
    /// For each concealing convention it synthesises an endpoint that composes that convention and then
    /// declares <c>403</c> anyway — the precise mistake Requirement 5.3 forbids, and one that no status-
    /// set heuristic could classify as its own subject — and requires the rule to report it, naming the
    /// route, the method and the offending status.
    /// </para>
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAConcealingEndpointThatAlsoDeclares403()
    {
        Assert.Equal(5, ConcealingConventions.Count);

        foreach ((string name, Func<ConventionRecorder, ConventionRecorder> compose) in ConcealingConventions)
        {
            string route = $"/synthesised/{name}/{{id:guid}}";

            ConcealingEndpointFact offender = ConventionRecorder
                .Composing(builder => compose(builder).ProducesProblem(StatusCodes.Status403Forbidden))
                .Synthesise(route, HttpMethods.Get);

            Assert.True(
                offender.ConcealsExistence,
                $"{name} did not mark its endpoint as existence-concealing, so the rule would have no "
                    + "subject and would pass over the very mistake it exists to catch.");

            IReadOnlyList<string> offences = Offences([offender]);

            Assert.Contains(
                offences,
                offence => offence.Contains(route, StringComparison.Ordinal)
                    && offence.Contains(HttpMethods.Get, StringComparison.Ordinal)
                    && offence.Contains("403", StringComparison.Ordinal));
        }
    }

    /// <summary>
    /// The discriminating control for the <c>404</c> half: an endpoint marked concealing that declares
    /// no <c>404</c> at all is reported too, naming its route, method and the missing status. Without
    /// this the rule could be satisfied by an endpoint that declares nothing a client could branch on.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAConcealingEndpointThatDeclaresNoNotFound()
    {
        const string Route = "/synthesised/no-not-found/{id:guid}";

        ConcealingEndpointFact offender = ConventionRecorder
            .Composing(static builder => builder
                .WithMetadata(ExistenceConcealingMetadata.Instance)
                .ProducesProblem(StatusCodes.Status400BadRequest))
            .Synthesise(Route, HttpMethods.Get);

        IReadOnlyList<string> offences = Offences([offender]);

        Assert.Contains(
            offences,
            offence => offence.Contains(Route, StringComparison.Ordinal)
                && offence.Contains(HttpMethods.Get, StringComparison.Ordinal)
                && offence.Contains("404", StringComparison.Ordinal));
    }

    /// <summary>
    /// The positive control, so the two failure controls above are not passing because the rule rejects
    /// everything: an endpoint composing each concealing convention and nothing else is reported clean,
    /// and each convention really does declare <c>404</c> without <c>403</c>.
    /// </summary>
    [Fact]
    public void TheRulePassesOnAnEndpointComposingAConcealingConventionAlone()
    {
        foreach ((string name, Func<ConventionRecorder, ConventionRecorder> compose) in ConcealingConventions)
        {
            ConcealingEndpointFact endpoint = ConventionRecorder
                .Composing(builder => compose(builder))
                .Synthesise($"/synthesised/{name}/{{id:guid}}", HttpMethods.Get);

            Assert.True(endpoint.ConcealsExistence, $"{name} attached no concealing marker.");
            Assert.True(endpoint.Endpoint.Declares(StatusCodes.Status404NotFound), $"{name} declares no 404.");
            Assert.False(endpoint.Endpoint.Declares(StatusCodes.Status403Forbidden), $"{name} declares 403.");

            Assert.Empty(Offences([endpoint]));
        }
    }

    /// <summary>
    /// Applies the rule and returns one message per offence. Non-concealing endpoints are passed over:
    /// an ordinary endpoint's <c>403</c> is its contract, not a leak.
    /// </summary>
    /// <param name="endpoints">The endpoints to check.</param>
    /// <returns>Every offence found, each naming the route, the method and the status at fault.</returns>
    private static IReadOnlyList<string> Offences(IEnumerable<ConcealingEndpointFact> endpoints)
    {
        var offences = new List<string>();

        foreach (ConcealingEndpointFact endpoint in
            endpoints.Where(static candidate => candidate.ConcealsExistence))
        {
            if (!endpoint.Endpoint.Declares(StatusCodes.Status404NotFound))
            {
                offences.Add(
                    $"{endpoint.Endpoint.Description} is existence-concealing but declares no 404; "
                        + "an authorisation failure there is reported as a not-found and has to be "
                        + "declared as one.");
            }

            if (endpoint.Endpoint.Declares(StatusCodes.Status403Forbidden))
            {
                offences.Add(
                    $"{endpoint.Endpoint.Description} is existence-concealing but declares 403; the "
                        + "declared status set would distinguish a non-member from a non-existent "
                        + "target that the responses themselves do not.");
            }
        }

        return offences;
    }

    /// <summary>Renders every offender in one message, so the output is a worklist.</summary>
    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));
}

/// <summary>
/// One discovered endpoint together with the single fact this guard needs beyond the shared projection:
/// whether it carries the <see cref="ExistenceConcealingMetadata"/> marker.
/// <para>
/// The shared facts come from <see cref="MappedEndpoint.From(RouteEndpoint)"/> rather than being
/// re-derived here, so there is one projection of an endpoint in the test suite and this type adds a
/// fact to it rather than a second reading of it. The marker is read here, and not added to
/// <see cref="MappedEndpoint"/>, because it is this guard's concern alone — the endpoint-metadata guard
/// reasons about statuses and authorisation and has no use for it.
/// </para>
/// </summary>
/// <param name="Endpoint">The endpoint as the shared projection reports it.</param>
/// <param name="ConcealsExistence">Whether a concealing convention marked the endpoint.</param>
public sealed record ConcealingEndpointFact(MappedEndpoint Endpoint, bool ConcealsExistence)
{
    /// <summary>Projects one route endpoint, shared facts plus the concealment marker.</summary>
    /// <param name="endpoint">The route endpoint to project.</param>
    /// <returns>The projected endpoint.</returns>
    public static ConcealingEndpointFact From(RouteEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        return new ConcealingEndpointFact(
            MappedEndpoint.From(endpoint),
            endpoint.Metadata.GetMetadata<ExistenceConcealingMetadata>() is not null);
    }

    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() =>
        ConcealsExistence ? $"{Endpoint} [existence-concealing]" : Endpoint.ToString();
}

/// <summary>
/// Boots the real Api once and asks it which of its mapped endpoints are existence-concealing.
/// <para>
/// The endpoints come from the host's own <see cref="EndpointDataSource"/>, as
/// <see cref="MappedEndpointCatalogue"/>'s do, and for the same reason: an endpoint added later enters
/// the assertions because it entered the router. This fixture exists alongside that one because the
/// shared projection deliberately reduces an endpoint to statuses and authorisation and drops the raw
/// metadata collection, and the concealment marker lives in that collection. It therefore reads the
/// data source itself and reuses <see cref="MappedEndpoint.From(RouteEndpoint)"/> for every fact the
/// two have in common, rather than re-deriving the projection or widening the shared record with a
/// fact only this guard uses.
/// </para>
/// <para>
/// Endpoints the framework flags as excluded from the API description are dropped, because they are not
/// operations of the committed document — the only one is the development-only OpenAPI document route.
/// </para>
/// </summary>
public sealed class ConcealingEndpointCatalogue : IDisposable
{
    private readonly AuthApiFactory _factory = new();

    /// <summary>
    /// Enumerates the mapped endpoints from the running host, ordered by route then method so failure
    /// output reads in a stable order across runs.
    /// </summary>
    public ConcealingEndpointCatalogue()
    {
        var dataSource = _factory.Services.GetRequiredService<EndpointDataSource>();

        Endpoints =
        [
            .. dataSource.Endpoints
                .OfType<RouteEndpoint>()
                .Where(static endpoint =>
                    endpoint.Metadata.GetMetadata<IExcludeFromDescriptionMetadata>()
                        ?.ExcludeFromDescription != true)
                .Select(ConcealingEndpointFact.From)
                .OrderBy(static endpoint => endpoint.Endpoint.Route, StringComparer.Ordinal)
                .ThenBy(static endpoint => endpoint.Endpoint.Method, StringComparer.Ordinal),
        ];

        ConcealingEndpoints = [.. Endpoints.Where(static endpoint => endpoint.ConcealsExistence)];
    }

    /// <summary>Every endpoint the running host reports as an operation of the surface.</summary>
    public IReadOnlyList<ConcealingEndpointFact> Endpoints { get; }

    /// <summary>The endpoints a concealing convention marked as existence-sensitive.</summary>
    public IReadOnlyList<ConcealingEndpointFact> ConcealingEndpoints { get; }

    /// <inheritdoc />
    public void Dispose() => _factory.Dispose();
}

/// <summary>
/// A minimal <see cref="IEndpointConventionBuilder"/> that records the conventions applied to it and
/// then builds the endpoint they describe, so a control can synthesise an endpoint composing a real
/// convention without mapping it onto the real surface.
/// <para>
/// The conventions under test are ordinary <see cref="IEndpointConventionBuilder"/> extensions, so
/// applying them here exercises the production code path rather than a re-statement of it: the
/// synthesised endpoint's declared statuses and concealment marker are whatever the real convention
/// puts there.
/// </para>
/// </summary>
public sealed class ConventionRecorder : IEndpointConventionBuilder
{
    private readonly List<Action<EndpointBuilder>> _conventions = [];

    /// <summary>Records one convention, as the framework does when an endpoint is being built.</summary>
    /// <param name="convention">The convention to record.</param>
    public void Add(Action<EndpointBuilder> convention)
    {
        ArgumentNullException.ThrowIfNull(convention);

        _conventions.Add(convention);
    }

    /// <summary>Starts a recorder and applies the given composition to it.</summary>
    /// <param name="compose">The conventions to compose, exactly as an endpoint would.</param>
    /// <returns>The recorder, ready to synthesise.</returns>
    public static ConventionRecorder Composing(Action<ConventionRecorder> compose)
    {
        ArgumentNullException.ThrowIfNull(compose);

        var recorder = new ConventionRecorder();
        compose(recorder);

        return recorder;
    }

    /// <summary>
    /// Builds the endpoint the recorded conventions describe and projects it the same way a discovered
    /// endpoint is projected, so a control and the real surface are judged by one rule.
    /// </summary>
    /// <param name="routePattern">The route pattern to synthesise.</param>
    /// <param name="httpMethod">The HTTP method to synthesise.</param>
    /// <returns>The projected synthesised endpoint.</returns>
    public ConcealingEndpointFact Synthesise(string routePattern, string httpMethod)
    {
        var builder = new RouteEndpointBuilder(
            static _ => Task.CompletedTask,
            RoutePatternFactory.Parse(routePattern),
            order: 0)
        {
            DisplayName = $"{httpMethod} {routePattern}",
        };

        builder.Metadata.Add(new HttpMethodMetadata([httpMethod]));

        foreach (Action<EndpointBuilder> convention in _conventions)
        {
            convention(builder);
        }

        return ConcealingEndpointFact.From((RouteEndpoint)builder.Build());
    }
}
