using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Application.Matches.UseCases;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 27 — A new read's refusal declares and conceals what the convention
/// says</b> (match-read-models task 7.8).
/// <para>
/// <b>Validates: Requirements 5.6, 13.14</b>
/// </para>
/// <para>
/// Over the mapped endpoints of the chore's reads — discovered from the host's
/// <see cref="Microsoft.AspNetCore.Routing.EndpointDataSource"/> as the endpoints whose success body is
/// one of <see cref="MatchReadContracts.Contracts"/>, never listed — each must carry
/// <see cref="ExistenceConcealingMetadata"/> and declare exactly the concealing convention's problem
/// statuses: <c>404</c>, <c>401</c> and the seam's other emittable statuses, and <b>no</b> <c>403</c>.
/// The rule names the route pattern and HTTP method of any read that does not. It covers the list read
/// today and all three reads from task 11.7 onward with no edit.
/// </para>
/// </summary>
public sealed class MatchReadConcealmentProperties : IClassFixture<ConcealingEndpointCatalogue>
{
    /// <summary>
    /// The non-vacuity floor on discovered chore reads: the list, detail and working-teams reads, all
    /// mapped from task 11.7 onward (it was one at task 7.8).
    /// </summary>
    private const int MinimumReadEndpointCount = 3;

    private static readonly IReadOnlySet<int> ConventionStatuses =
        MatchResponseConventions.DeclaredConcealedProblemStatuses.ToHashSet();

    private readonly IReadOnlyList<ConcealingEndpointFact> _reads;

    /// <summary>Receives the catalogue of endpoints read off the running host.</summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    public MatchReadConcealmentProperties(ConcealingEndpointCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        _reads = [.. catalogue.Endpoints.Where(IsChoreRead)];
    }

    // Feature: match-read-models, Property 27: A new read's refusal declares and conceals what the
    // convention says.
    /// <summary>
    /// **Validates: Requirements 5.6, 13.14** — the rule classifies synthesised read endpoints of every
    /// shape correctly: an endpoint passes iff it carries the concealing marker and declares exactly the
    /// convention's problem statuses, and every failure names its route and method.
    /// </summary>
    [Property(MaxTest = 100)]
    public Property TheRuleClassifiesEverySynthesisedReadShape() =>
        Prop.ForAll(
            Arb.From(
                from marked in ArbMap.Default.GeneratorFor<bool>()
                from statuses in Gen.SubListOf(
                [
                    StatusCodes.Status400BadRequest,
                    StatusCodes.Status401Unauthorized,
                    StatusCodes.Status403Forbidden,
                    StatusCodes.Status404NotFound,
                    StatusCodes.Status409Conflict,
                    StatusCodes.Status500InternalServerError,
                ])
                select (Marked: marked, Statuses: statuses.ToArray())),
            shape =>
            {
                const string Route = "/synthesised/squads/{squadId:guid}/matches";
                ConcealingEndpointFact endpoint = SynthesiseRead(Route, shape.Marked, shape.Statuses);

                bool conforms = shape.Marked && shape.Statuses.ToHashSet().SetEquals(ConventionStatuses);
                IReadOnlyList<string> offences = Offences([endpoint]);

                bool namesItself = offences.All(static offence =>
                    offence.Contains(Route, StringComparison.Ordinal)
                    && offence.Contains(HttpMethods.Get, StringComparison.Ordinal));

                return (conforms == (offences.Count == 0) && namesItself)
                    .ToProperty()
                    .Label($"marked={shape.Marked} statuses=[{string.Join(",", shape.Statuses)}] -> {string.Join("; ", offences)}")
                    .Collect(conforms ? "conforming" : "offending");
            });

    /// <summary>
    /// The exhaustive sweep over the host: every discovered chore read conceals and declares what the
    /// convention says, reported as a worklist naming each offender's route and method.
    /// </summary>
    [Fact]
    public void EveryChoreReadConcealsAndDeclaresTheConventionsStatuses()
    {
        IReadOnlyList<string> offences = Offences(_reads);

        Assert.True(
            offences.Count == 0,
            $"{offences.Count} chore read offence(s):{Environment.NewLine}"
                + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}")));
    }

    /// <summary>
    /// The non-vacuity floor: discovery found the chore's reads, so the sweep above ranged over
    /// something. Also pins that discovery found the list read's contract, so the floor cannot be met
    /// by some unrelated endpoint.
    /// </summary>
    [Fact]
    public void TheDiscoveredReadSetIsNonVacuous()
    {
        Assert.Contains(typeof(MatchList), MatchReadContracts.Contracts);
        Assert.True(
            _reads.Count >= MinimumReadEndpointCount,
            $"Only {_reads.Count} chore read endpoint(s) were discovered; at least {MinimumReadEndpointCount} are mapped. "
                + $"Contracts discovered: {string.Join(", ", MatchReadContracts.Contracts.Select(static type => type.Name))}");
    }

    /// <summary>
    /// The planted-violation control: a read answering with a chore contract but missing the concealing
    /// marker fails, naming its route and method — while declaring the right statuses, so the marker
    /// check is what catches it.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAReadMissingTheConcealingMarker()
    {
        const string Route = "/synthesised/squads/{squadId:guid}/matches";

        ConcealingEndpointFact offender = SynthesiseRead(Route, marked: false, [.. ConventionStatuses]);

        Assert.True(IsChoreRead(offender));
        Assert.Contains(
            Offences([offender]),
            static offence => offence.Contains(Route, StringComparison.Ordinal)
                && offence.Contains(HttpMethods.Get, StringComparison.Ordinal)
                && offence.Contains("marker", StringComparison.Ordinal));
    }

    /// <summary>
    /// The second planted control: a marked read that also declares <c>403</c> fails, naming the
    /// status — the status set would otherwise tell a non-member from a missing squad.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAMarkedReadThatDeclaresForbidden()
    {
        const string Route = "/synthesised/matches/{matchId:guid}";

        ConcealingEndpointFact offender = SynthesiseRead(
            Route, marked: true, [.. ConventionStatuses, StatusCodes.Status403Forbidden]);

        Assert.Contains(
            Offences([offender]),
            static offence => offence.Contains(Route, StringComparison.Ordinal)
                && offence.Contains("403", StringComparison.Ordinal));
    }

    /// <summary>Whether an endpoint answers with one of the chore's read contracts.</summary>
    private static bool IsChoreRead(ConcealingEndpointFact endpoint) =>
        endpoint.Endpoint.DeclaredSuccessResponses.Any(static response =>
            response.BodyType is { } body && MatchReadContracts.Contracts.Contains(body));

    /// <summary>
    /// Applies the rule: each read must carry the marker and declare exactly the convention's problem
    /// statuses. Every offence names the route pattern and HTTP method.
    /// </summary>
    private static IReadOnlyList<string> Offences(IEnumerable<ConcealingEndpointFact> reads)
    {
        var offences = new List<string>();

        foreach (ConcealingEndpointFact read in reads)
        {
            string at = read.Endpoint.Description;

            if (!read.ConcealsExistence)
            {
                offences.Add($"{at} carries no existence-concealing marker.");
            }

            HashSet<int> declared =
            [
                .. read.Endpoint.DeclaredResponses
                    .Where(static response => !response.IsSuccess)
                    .Select(static response => response.Status),
            ];

            foreach (int missing in ConventionStatuses.Except(declared).Order())
            {
                offences.Add($"{at} does not declare {missing}, which the concealing convention declares.");
            }

            foreach (int extra in declared.Except(ConventionStatuses).Order())
            {
                offences.Add(extra == StatusCodes.Status403Forbidden
                    ? $"{at} declares 403; a concealed read must answer a non-member as 404."
                    : $"{at} declares {extra}, which the concealing convention does not.");
            }
        }

        return offences;
    }

    /// <summary>
    /// Synthesises a GET read answering with <see cref="MatchList"/> that declares the given problem
    /// statuses and, optionally, the concealing marker.
    /// </summary>
    private static ConcealingEndpointFact SynthesiseRead(string route, bool marked, IReadOnlyList<int> statuses) =>
        ConventionRecorder
            .Composing(builder =>
            {
                builder.WithMetadata(new ProducesResponseTypeMetadata(StatusCodes.Status200OK, typeof(MatchList), ["application/json"]));

                foreach (int status in statuses)
                {
                    builder.ProducesProblem(status);
                }

                if (marked)
                {
                    builder.WithMetadata(ExistenceConcealingMetadata.Instance);
                }
            })
            .Synthesise(route, HttpMethods.Get);
}
