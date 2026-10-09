using System.Globalization;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// <b>Property 2 — Authorisation and the declared 401 correspond, with one explicit exception.</b>
/// <para>
/// <b>Validates: Requirements 2.8, 2.9, 3.3, 3.4, 5.4</b>
/// </para>
/// <para>
/// The property has two halves, and they answer different questions.
/// </para>
/// <para>
/// The <b>exhaustive half</b> quantifies over the endpoints the running host reports — not a list in
/// the test (Requirement 3.1) — and applies <see cref="AuthorizationDeclarationRule"/>'s two rules to
/// every one of them: a guarded endpoint declares <c>401</c> (Requirements 2.8, 3.3), an anonymous one
/// declares neither <c>401</c> nor <c>403</c> (Requirement 2.9), and each rule honours only its own
/// explicitly listed exception (Requirement 3.4). A third conjunct closes the biconditional in the
/// direction the guard does not state: the two stats routes, which the exception excuses from
/// declaring <c>401</c>, must also <i>not</i> declare it (Requirement 5.4) — otherwise "declares
/// <c>401</c> exactly when guarded and outside the list" would hold only one way, and the concealment
/// those two reads exist to provide would be given away by their contract. Because the surface is a
/// finite discovered set, exhausting it is strictly stronger than sampling it, which is why this half
/// is a fact over the real catalogue rather than an FsCheck generator.
/// </para>
/// <para>
/// The <b>discriminating half</b> is the part that earns the property. On its own the exhaustive half
/// re-states what the declaration pass already made green; a rule that returned no violations for
/// <i>anything</i> would satisfy it just as well. So the rules are also applied to endpoints
/// synthesised precisely to break them — a guarded endpoint with no <c>401</c>, an anonymous endpoint
/// declaring <c>401</c>, and an anonymous endpoint declaring <c>403</c> — and each must be reported in
/// a message naming <i>that</i> route, <i>that</i> method and the status at fault rather than merely
/// objecting in general. Each case carries a well-formed twin at the same route and method which must
/// be reported clean, so the control shows the rules discriminating rather than complaining
/// indiscriminately.
/// </para>
/// <para>
/// The <b>exceptions are controlled in both directions too</b>, which is the substance of Requirement
/// 3.4. The same defective shape is synthesised at a route <i>inside</i> each pinned exception list and
/// must be reported clean — proving the exception is honoured — and at a route outside it and must be
/// reported — proving the rule is not blanket. An exception that excused everything and a rule that
/// excused nothing would both pass a test that only ever looked at one side.
/// </para>
/// <para>
/// Both halves call the same predicate, and both honour the same two pinned exception lists, which stay
/// where <see cref="EndpointMetadataGuardTests"/> holds them to their size and shape. So this property
/// proves the teeth of the rules the production guard actually applies — not of a second copy that
/// could drift loose while the guard stayed green.
/// </para>
/// </summary>
public sealed class AuthorizationDeclarationProperties : IClassFixture<MappedEndpointCatalogue>
{
    /// <summary>
    /// The non-vacuity floor (Requirement 3.8): the 66 operations of the pre-change document plus
    /// <c>GET /auth/me</c>.
    /// </summary>
    private const int MinimumMappedEndpointCount = 67;

    private readonly MappedEndpointCatalogue _catalogue;

    /// <summary>Receives the shared catalogue of endpoints read off the running host.</summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    public AuthorizationDeclarationProperties(MappedEndpointCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        _catalogue = catalogue;
    }

    /// <summary>
    /// Every way the correspondence can be broken, named individually for the exhaustive companion to
    /// the generated half.
    /// </summary>
    /// <returns>One case per defect.</returns>
    public static TheoryData<string> AllDefects()
    {
        var data = new TheoryData<string>();

        foreach (string defectName in SynthesisedAuthorisationCase.DefectNames)
        {
            data.Add(defectName);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 2: Authorisation and the declared 401 correspond, with
    // one explicit exception.
    // Validates: Requirements 2.8, 2.9, 3.3, 3.4
    /// <summary>
    /// The exhaustive half: every endpoint the host mapped satisfies both rules. Quantified over the
    /// discovered set, so an endpoint mapped next year enters this assertion without the test being
    /// edited.
    /// </summary>
    [Fact]
    [Trait("Property", "2")]
    public void Property2_EveryEndpointTheHostReportsCorrespondsWithItsDeclaredUnauthorized()
    {
        IReadOnlyList<string> violations = Violations(_catalogue.Endpoints);

        Assert.True(
            violations.Count == 0,
            $"{violations.Count} endpoints break the 401 correspondence:{Environment.NewLine}"
                + string.Join(Environment.NewLine, violations.Select(static v => $"  - {v}")));
    }

    // Feature: api-response-contracts, Property 2: Authorisation and the declared 401 correspond, with
    // one explicit exception.
    // Validates: Requirement 5.4
    /// <summary>
    /// The other direction of the biconditional, and the one the guard's rule cannot state: the two
    /// routes the stats exception excuses from declaring <c>401</c> must declare no <c>401</c>
    /// (Requirement 5.4).
    /// <para>
    /// The exception exists because a missing token on an existence-concealing read resolves to the
    /// same byte-for-byte <c>404</c> as a target that does not exist. An endpoint that took the
    /// exception and declared <c>401</c> anyway would keep behaving correctly and still hand the tell
    /// back through its contract — so "declares <c>401</c> exactly when guarded and outside the list"
    /// is asserted both ways round.
    /// </para>
    /// </summary>
    [Fact]
    [Trait("Property", "2")]
    public void Property2_TheStatsExceptionEndpointsDeclareNoUnauthorized()
    {
        IReadOnlyList<MappedEndpoint> exempt =
        [
            .. _catalogue.Endpoints.Where(static endpoint =>
                EndpointMetadataGuardTests.StatsRoutesExemptFromDeclaredUnauthorized.Contains(
                    endpoint.Route,
                    StringComparer.Ordinal)),
        ];

        Assert.NotEmpty(exempt);

        Assert.All(exempt, endpoint =>
            Assert.False(
                endpoint.Declares(StatusCodes.Status401Unauthorized),
                $"{endpoint.Description} takes the stats exception to the 401 rule and declares 401 "
                    + "anyway; an unauthenticated caller and a non-member caller must see the same "
                    + "concealed not-found declared."));
    }

    // Feature: api-response-contracts, Property 2: Authorisation and the declared 401 correspond, with
    // one explicit exception.
    // Validates: Requirements 2.8, 2.9, 3.3
    /// <summary>
    /// The discriminating half, over arbitrary routes and methods: an endpoint that breaks the
    /// correspondence is reported, the report names that endpoint's route, method and offending status,
    /// and a well-formed endpoint at the same route and method is reported clean.
    /// <para>
    /// The route and method are generated rather than fixed so the naming conjunct is a statement about
    /// the rules' message construction — they name whatever endpoint they were handed — rather than a
    /// coincidence of one hard-coded string.
    /// </para>
    /// </summary>
    /// <param name="synthesised">The synthesised offending endpoint and its well-formed twin.</param>
    /// <returns>The property.</returns>
    [Property(MaxTest = 300, Arbitrary = new[] { typeof(SynthesisedAuthorisationCaseGenerators) })]
    [Trait("Property", "2")]
    public Property Property2_AnEndpointBreakingTheCorrespondenceIsReportedByRouteAndMethod(
        SynthesisedAuthorisationCase synthesised)
    {
        ArgumentNullException.ThrowIfNull(synthesised);

        IReadOnlyList<string> reported = Violations(synthesised.Offender);
        IReadOnlyList<string> twin = Violations(synthesised.WellFormed);

        bool failsNamingTheEndpoint = reported.Count > 0
            && reported.All(message =>
                message.Contains(synthesised.Route, StringComparison.Ordinal)
                    && message.Contains(synthesised.Method, StringComparison.Ordinal)
                    && message.Contains(
                        synthesised.OffendingStatus.ToString(CultureInfo.InvariantCulture),
                        StringComparison.Ordinal));

        return (failsNamingTheEndpoint && twin.Count == 0)
            .ToProperty()
            .Label(
                $"{synthesised}: reported [{string.Join(" | ", reported)}]; "
                    + $"well-formed twin reported [{string.Join(" | ", twin)}]")
            .Collect(synthesised.DefectName);
    }

    /// <summary>
    /// The exhaustive companion to the discriminating half: all three ways the correspondence can be
    /// broken, named individually so a failure identifies the defect rather than a shrunk
    /// counterexample.
    /// </summary>
    /// <param name="defectName">The defect under test.</param>
    [Theory]
    [MemberData(nameof(AllDefects))]
    [Trait("Property", "2")]
    public void EachWayOfBreakingTheCorrespondenceIsReportedNamingTheRouteAndMethod(string defectName)
    {
        SynthesisedAuthorisationCase synthesised =
            SynthesisedAuthorisationCase.For("/synthesised/{id:guid}/thing", "PATCH", defectName);

        IReadOnlyList<string> reported = Violations(synthesised.Offender);

        Assert.NotEmpty(reported);
        Assert.All(reported, message =>
        {
            Assert.Contains(synthesised.Route, message, StringComparison.Ordinal);
            Assert.Contains(synthesised.Method, message, StringComparison.Ordinal);
            Assert.Contains(
                synthesised.OffendingStatus.ToString(CultureInfo.InvariantCulture),
                message,
                StringComparison.Ordinal);
        });

        // The rules discriminate: the same route and method, declared properly, is reported clean.
        Assert.Empty(Violations(synthesised.WellFormed));
    }

    /// <summary>
    /// Requirement 3.4, the stats exception, controlled in both directions: a guarded endpoint
    /// declaring no <c>401</c> is reported clean at each of the two exempted routes and reported at a
    /// route outside the list.
    /// <para>
    /// Without the second half this would pass for a rule that excused every endpoint; without the
    /// first it would pass for a rule that honoured no exception at all.
    /// </para>
    /// </summary>
    [Fact]
    [Trait("Property", "2")]
    public void TheStatsExceptionExcusesOnlyItsOwnRoutesFromDeclaring401()
    {
        Assert.NotEmpty(EndpointMetadataGuardTests.StatsRoutesExemptFromDeclaredUnauthorized);

        foreach (string route in EndpointMetadataGuardTests.StatsRoutesExemptFromDeclaredUnauthorized)
        {
            SynthesisedAuthorisationCase exempt = SynthesisedAuthorisationCase.For(
                route,
                HttpMethods.Get,
                SynthesisedAuthorisationCase.AuthorisedWithoutUnauthorized);

            Assert.True(
                exempt.Offender.RequiresAuthorization,
                $"{route} was not synthesised as a guarded endpoint, so the exception would be "
                    + "excusing an endpoint the rule never judged.");
            Assert.False(exempt.Offender.Declares(StatusCodes.Status401Unauthorized));

            Assert.Empty(Violations(exempt.Offender));
        }

        SynthesisedAuthorisationCase outside = SynthesisedAuthorisationCase.For(
            "/squads/{squadId:guid}/leaderboard/not-the-exempt-route",
            HttpMethods.Get,
            SynthesisedAuthorisationCase.AuthorisedWithoutUnauthorized);

        Assert.NotEmpty(Violations(outside.Offender));
    }

    /// <summary>
    /// Requirement 2.9's exception, controlled in both directions: an anonymous endpoint declaring
    /// <c>401</c> or <c>403</c> is reported clean at each of the seven public auth routes, whose seam
    /// genuinely answers those statuses as the endpoint's own outcome, and reported at a route outside
    /// that list.
    /// </summary>
    [Fact]
    [Trait("Property", "2")]
    public void TheAnonymousAuthExceptionExcusesOnlyItsOwnRoutesFromTheProhibition()
    {
        Assert.NotEmpty(EndpointMetadataGuardTests.AnonymousAuthRoutesEmittingDomainAuthStatuses);

        foreach (string route in EndpointMetadataGuardTests.AnonymousAuthRoutesEmittingDomainAuthStatuses)
        {
            foreach (string defect in
                (string[])
                [
                    SynthesisedAuthorisationCase.AnonymousDeclaringUnauthorized,
                    SynthesisedAuthorisationCase.AnonymousDeclaringForbidden,
                ])
            {
                SynthesisedAuthorisationCase exempt =
                    SynthesisedAuthorisationCase.For(route, HttpMethods.Post, defect);

                Assert.True(
                    exempt.Offender.IsAnonymous,
                    $"{route} was not synthesised as an anonymous endpoint, so the exception would be "
                        + "excusing an endpoint the rule never judged.");
                Assert.True(exempt.Offender.Declares(exempt.OffendingStatus));

                Assert.Empty(Violations(exempt.Offender));
            }
        }

        SynthesisedAuthorisationCase outside = SynthesisedAuthorisationCase.For(
            "/auth/register/not-the-exempt-route",
            HttpMethods.Post,
            SynthesisedAuthorisationCase.AnonymousDeclaringUnauthorized);

        Assert.NotEmpty(Violations(outside.Offender));
    }

    /// <summary>
    /// The positive control, so the failure controls above are not passing because the rules reject
    /// everything: a guarded endpoint declaring <c>401</c> and an anonymous endpoint declaring neither
    /// authorisation status are both reported clean, at the same route and method.
    /// </summary>
    [Fact]
    [Trait("Property", "2")]
    public void TheRulesPassOnAProperlyDeclaredAuthorisedEndpointAndAProperlyDeclaredAnonymousOne()
    {
        MappedEndpoint guarded = SynthesisedAuthorisationCase
            .For("/synthesised/well-formed/{id:guid}", HttpMethods.Get,
                SynthesisedAuthorisationCase.AuthorisedWithoutUnauthorized)
            .WellFormed;

        Assert.True(guarded.RequiresAuthorization);
        Assert.True(guarded.Declares(StatusCodes.Status401Unauthorized));
        Assert.Empty(Violations(guarded));

        MappedEndpoint anonymous = SynthesisedAuthorisationCase
            .For("/synthesised/well-formed/{id:guid}", HttpMethods.Get,
                SynthesisedAuthorisationCase.AnonymousDeclaringUnauthorized)
            .WellFormed;

        Assert.True(anonymous.IsAnonymous);
        Assert.False(anonymous.Declares(StatusCodes.Status401Unauthorized));
        Assert.False(anonymous.Declares(StatusCodes.Status403Forbidden));
        Assert.Empty(Violations(anonymous));
    }

    /// <summary>
    /// Requirements 3.8 and 5.4 — the floor under the exhaustive half, and the one check that stops it
    /// from holding vacuously.
    /// <para>
    /// At least 67 endpoints were quantified over; every one of them was described well enough to judge
    /// (a route and a concrete method, which is what the rules' messages name); and <b>both populations
    /// are present</b> — at least one guarded endpoint and at least one anonymous one — so neither rule
    /// quantifies over nothing. A surface that had become wholly anonymous would satisfy the <c>401</c>
    /// rule trivially, and one that had become wholly guarded would satisfy the prohibition trivially;
    /// either would be the kind of silent green an exhaustive check over a discovered set is prone to.
    /// The guarded population is also required to be non-empty <i>outside</i> the stats exception, since
    /// that is the population the <c>401</c> rule actually judges.
    /// </para>
    /// </summary>
    [Fact]
    [Trait("Property", "2")]
    public void TheQuantifiedSurfaceIsNonVacuousAndBothPopulationsArePresent()
    {
        Assert.True(
            _catalogue.Endpoints.Count >= MinimumMappedEndpointCount,
            $"Endpoint discovery found {_catalogue.Endpoints.Count} endpoints; "
                + $"at least {MinimumMappedEndpointCount} are mapped. "
                + "A property quantified over nothing holds for everything.");

        Assert.All(_catalogue.Endpoints, endpoint =>
        {
            Assert.StartsWith("/", endpoint.Route, StringComparison.Ordinal);
            Assert.NotEqual("(any)", endpoint.Method);
        });

        IReadOnlyList<MappedEndpoint> guarded =
            [.. _catalogue.Endpoints.Where(static endpoint => endpoint.RequiresAuthorization)];
        IReadOnlyList<MappedEndpoint> anonymous =
            [.. _catalogue.Endpoints.Where(static endpoint => endpoint.IsAnonymous)];

        Assert.NotEmpty(guarded);
        Assert.NotEmpty(anonymous);

        // The 401 rule's actual subject: guarded endpoints the stats exception does not excuse.
        Assert.Contains(
            guarded,
            static endpoint =>
                !EndpointMetadataGuardTests.StatsRoutesExemptFromDeclaredUnauthorized.Contains(
                    endpoint.Route,
                    StringComparer.Ordinal));

        // The prohibition's actual subject: anonymous endpoints the auth exception does not excuse.
        Assert.Contains(
            anonymous,
            static endpoint =>
                !EndpointMetadataGuardTests.AnonymousAuthRoutesEmittingDomainAuthStatuses.Contains(
                    endpoint.Route,
                    StringComparer.Ordinal));
    }

    /// <summary>
    /// Applies both rules to one endpoint, honouring the two pinned exception lists the production
    /// guard honours. The two are applied together because a single endpoint is the subject of exactly
    /// one of them — guarded or anonymous — so the union is the correspondence itself.
    /// </summary>
    /// <param name="endpoint">The endpoint to judge.</param>
    /// <returns>Every violation found, each naming the route, the method and the status at fault.</returns>
    private static IReadOnlyList<string> Violations(MappedEndpoint endpoint) =>
    [
        .. AuthorizationDeclarationRule.AuthorisedEndpointsMissingUnauthorized(
            endpoint,
            EndpointMetadataGuardTests.StatsRoutesExemptFromDeclaredUnauthorized),
        .. AuthorizationDeclarationRule.AnonymousEndpointsDeclaringAuthorisationStatus(
            endpoint,
            EndpointMetadataGuardTests.AnonymousAuthRoutesEmittingDomainAuthStatuses),
    ];

    /// <summary>Applies both rules across a set of endpoints, gathering every offender.</summary>
    /// <param name="endpoints">The endpoints to judge.</param>
    /// <returns>One message per violation across the whole set.</returns>
    private static IReadOnlyList<string> Violations(IEnumerable<MappedEndpoint> endpoints) =>
        [.. endpoints.SelectMany(Violations)];
}

/// <summary>
/// An endpoint that was never mapped: a real endpoint built from real conventions with deliberately
/// defective authorisation metadata, so the two authorisation-declaration rules can be shown to
/// <i>reject</i> something.
/// <para>
/// It is synthesised through <see cref="ConventionRecorder"/> — the harness that records real
/// <see cref="IEndpointConventionBuilder"/> conventions and builds the endpoint they describe — and
/// projected through the production <see cref="MappedEndpoint.From(Microsoft.AspNetCore.Routing.RouteEndpoint)"/>,
/// not hand-built as a <see cref="MappedEndpoint"/> literal. That matters twice over here. The rules
/// read <see cref="MappedEndpoint.RequiresAuthorization"/>, which is the projection's reading of the
/// framework's own <see cref="Microsoft.AspNetCore.Authorization.IAuthorizeData"/> and
/// <see cref="Microsoft.AspNetCore.Authorization.IAllowAnonymous"/> metadata; and the guarded cases are
/// guarded by calling the real <c>RequireAuthorization()</c>. A hand-built literal would sail past a
/// projection that had stopped recognising either, leaving the guard vacuous on the live surface.
/// </para>
/// <para>
/// The three defects are the three ways the correspondence can be broken — the guarded endpoint with no
/// <c>401</c> (Requirements 2.8, 3.3), and the anonymous endpoint declaring <c>401</c> or <c>403</c>
/// (Requirement 2.9) — and each case carries a <see cref="WellFormed"/> twin at the same route and
/// method, so the control shows the rules discriminating rather than merely objecting to everything.
/// </para>
/// </summary>
/// <param name="Route">The route pattern the synthesised endpoint is mapped at.</param>
/// <param name="Method">The HTTP method it is mapped for.</param>
/// <param name="DefectName">
/// The name of the defect, used for FsCheck classification and for naming the exhaustive cases.
/// </param>
public sealed record SynthesisedAuthorisationCase(string Route, string Method, string DefectName)
{
    /// <summary>A guarded endpoint that declares problem statuses but never <c>401</c>.</summary>
    public const string AuthorisedWithoutUnauthorized = "authorised without 401";

    /// <summary>An anonymous endpoint advertising the authentication challenge it does not have.</summary>
    public const string AnonymousDeclaringUnauthorized = "anonymous declaring 401";

    /// <summary>An anonymous endpoint advertising a forbidden it cannot return.</summary>
    public const string AnonymousDeclaringForbidden = "anonymous declaring 403";

    /// <summary>Every defect name, so the exhaustive companion can cover all three by name.</summary>
    public static IReadOnlyList<string> DefectNames =>
    [
        AuthorisedWithoutUnauthorized,
        AnonymousDeclaringUnauthorized,
        AnonymousDeclaringForbidden,
    ];

    /// <summary>
    /// The status the rule's message has to name for this case — the missing <c>401</c> for the guarded
    /// defect, the prohibited status for the anonymous ones.
    /// </summary>
    public int OffendingStatus => DefectName switch
    {
        AuthorisedWithoutUnauthorized or AnonymousDeclaringUnauthorized =>
            StatusCodes.Status401Unauthorized,
        AnonymousDeclaringForbidden => StatusCodes.Status403Forbidden,
        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// The synthesised offending endpoint as the rules see it — built from real conventions and
    /// projected through the production projection.
    /// </summary>
    public MappedEndpoint Offender => DefectName switch
    {
        // Guarded, and declaring the rest of its seam's problem set but not the challenge: the shape a
        // route acquires when RequireAuthorization() is added without the matching declaration.
        AuthorisedWithoutUnauthorized => Project(static builder => builder
            .RequireAuthorization()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)),

        // Anonymous, and advertising a gate that is not there.
        AnonymousDeclaringUnauthorized => Project(static builder => builder
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)),

        AnonymousDeclaringForbidden => Project(static builder => builder
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)),

        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// The same route and method, declared properly: the guarded defect's twin is guarded and declares
    /// <c>401</c>; the anonymous defects' twin is anonymous and declares neither status. The rules must
    /// find nothing wrong with either, or the controls above would prove only that they complain
    /// indiscriminately.
    /// </summary>
    public MappedEndpoint WellFormed => DefectName switch
    {
        AuthorisedWithoutUnauthorized => Project(static builder => builder
            .RequireAuthorization()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status404NotFound)),

        AnonymousDeclaringUnauthorized or AnonymousDeclaringForbidden => Project(static builder => builder
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)),

        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// Builds the case for one defect at the given route and method.
    /// </summary>
    /// <param name="route">The route pattern.</param>
    /// <param name="method">The HTTP method.</param>
    /// <param name="defectName">One of <see cref="DefectNames"/>.</param>
    /// <returns>The synthesised case.</returns>
    public static SynthesisedAuthorisationCase For(string route, string method, string defectName)
    {
        if (!DefectNames.Contains(defectName, StringComparer.Ordinal))
        {
            throw new ArgumentOutOfRangeException(nameof(defectName), defectName, "Unknown defect.");
        }

        return new SynthesisedAuthorisationCase(route, method, defectName);
    }

    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{Method} {Route} — {DefectName}";

    private MappedEndpoint Project(Action<ConventionRecorder> compose) =>
        ConventionRecorder.Composing(compose).Synthesise(Route, Method).Endpoint;
}

/// <summary>
/// FsCheck arbitraries for <see cref="SynthesisedAuthorisationCase"/>.
/// <para>
/// The route and method are drawn from the generator Property 1 already uses
/// (<see cref="SynthesisedEndpointCaseGenerators"/>) rather than from a second route generator written
/// here: those routes are assembled from literal and parameterised segments and are known to parse as
/// route patterns, which is a requirement rather than a nicety because the case builds a real endpoint
/// from them. Generated routes all begin <c>/synthesised</c>, so none of them can collide with either
/// pinned exception list — the exceptions are controlled separately, at their own real routes.
/// </para>
/// </summary>
public static class SynthesisedAuthorisationCaseGenerators
{
    /// <summary>Arbitrary for a single synthesised authorisation case.</summary>
    /// <returns>The arbitrary.</returns>
    public static Arbitrary<SynthesisedAuthorisationCase> SynthesisedAuthorisationCase() =>
        Arb.From(
            from source in SynthesisedEndpointCaseGenerators.SynthesisedEndpointCase().Generator
            from defect in Gen.Elements(Contracts.SynthesisedAuthorisationCase.DefectNames.ToArray())
            select Contracts.SynthesisedAuthorisationCase.For(source.Route, source.Method, defect));
}
