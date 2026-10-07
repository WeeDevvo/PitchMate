using System.Text;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The Concealment_Guard for <b>Property 10 — A concealed not-found is indistinguishable and carries no
/// code</b>.
/// <para>
/// <b>Validates: Requirements 5.1, 5.2, 5.5, 5.6, 5.8</b>
/// </para>
/// <para>
/// A concealed not-found exists to make two different answers look like one: "you are not a member of
/// that squad" and "there is no such squad" must be the same response, or the difference between them
/// is an oracle for enumerating squads, matches, notifications and players. The guarantee is therefore
/// a fact about the <i>bytes</i>, not about the status — two <c>404</c>s whose titles differ conceal
/// nothing — and it is a fact that decays quietly. Every seam here answers correctly today; a later
/// hand reaching for the error's <c>Message</c> to make a <c>404</c> more helpful would keep every
/// status test green while handing the tell straight back.
/// </para>
/// <para>
/// So this guard compares, for each concealing seam, every pair of distinct failures that seam masks:
/// same status, same bytes. The pairs come from <see cref="ConcealingSeams"/>, which calls the real
/// seams and gives each masked failure its own diagnostic text — identity can only hold because the
/// body is genuinely fixed, not because two identical inputs were compared.
/// </para>
/// <para>
/// The second half is the <c>code</c> extension. Everywhere else on this surface the <c>code</c> member
/// is the point: it is the stable value a client branches on, which is why Requirement 2.11 puts it on
/// every problem body. On a concealed not-found it is precisely the wrong thing to carry, because the
/// cause is what the response exists to hide — a <c>404</c> reading <c>"code": "Unauthorized"</c>
/// conceals nothing while looking like it does. The walk is therefore recursive: a code nested inside
/// an <c>errors</c> object would be just as much of a tell as a root member, and a root-only check
/// would call it clean.
/// </para>
/// <para>
/// Requirement 5.8 extends the same reasoning to the document. If a concealing endpoint's <c>404</c>
/// were described by its own body schema, the document would distinguish a concealing endpoint from an
/// ordinary one even though the responses do not — so
/// <see cref="EveryDeclared404DescribesTheOneProblemBodyShape"/> asserts every declared <c>404</c> on
/// the surface, concealing or not, names the single <see cref="ProblemDetails"/> shape.
/// </para>
/// <para>
/// What this guard does not speak about: which statuses a concealing endpoint <i>declares</i> is
/// <see cref="ConcealingStatusSetProperties"/>'s subject, and that every <i>non</i>-concealed problem
/// does carry its code is Property 11's.
/// </para>
/// </summary>
public sealed class ConcealmentProperties
    : IClassFixture<ConcealedNotFoundCatalogue>, IClassFixture<ConcealingEndpointCatalogue>
{
    private readonly ConcealedNotFoundCatalogue _catalogue;
    private readonly ConcealingEndpointCatalogue _endpoints;

    /// <summary>Receives the captured seam responses and the endpoints read off the running host.</summary>
    /// <param name="catalogue">The captured concealed and disclosing seam responses.</param>
    /// <param name="endpoints">The discovered endpoint catalogue.</param>
    public ConcealmentProperties(ConcealedNotFoundCatalogue catalogue, ConcealingEndpointCatalogue endpoints)
    {
        ArgumentNullException.ThrowIfNull(catalogue);
        ArgumentNullException.ThrowIfNull(endpoints);

        _catalogue = catalogue;
        _endpoints = endpoints;
    }

    // Feature: api-response-contracts, Property 10: A concealed not-found is indistinguishable and
    // carries no code — for any concealing seam and any pair of distinct failures it conceals, the two
    // responses are byte-for-byte identical in status and serialised body, and neither body contains a
    // `code` member anywhere within it.
    // Validates: Requirements 5.1, 5.2, 5.5, 5.6
    [Property(MaxTest = 300)]
    [Trait("Property", "10")]
    public Property Property10_AConcealedNotFoundIsIndistinguishableAndCarriesNoCode() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(_catalogue.Pairs.ToArray())),
            (ConcealedPair pair) =>
            {
                IReadOnlyList<string> offences = Offences([pair]);

                return (offences.Count == 0)
                    .ToProperty()
                    .Label(string.Join("; ", offences))
                    .Collect(pair.SeamName);
            });

    /// <summary>
    /// The exhaustive companion to the property: the same rule over every discovered pair at once, so a
    /// failure reports <i>every</i> offending pair as a worklist rather than the single shrunk
    /// counterexample a property failure yields. Each offence names the seam, both producers and the
    /// causes they stand for.
    /// </summary>
    [Fact]
    public void EveryConcealedPairIsIndistinguishableAndCarriesNoCode()
    {
        IReadOnlyList<string> offences = Offences(_catalogue.Pairs);

        Assert.True(offences.Count == 0, Report("distinguishable concealed not-founds", offences));
    }

    /// <summary>
    /// Requirement 5.8 over the declared contract. A concealed <c>404</c> must be described by the same
    /// body shape as any other <c>404</c>, so the document distinguishes a concealing endpoint from an
    /// ordinary one <i>only</i> by the statuses it declares.
    /// <para>
    /// Asserted over the declared metadata of the running host rather than over the committed document,
    /// because the committed document is regenerated once at the end of this change and is stale by
    /// design until then; the metadata is what the document will be generated from.
    /// </para>
    /// </summary>
    [Fact]
    public void EveryDeclared404DescribesTheOneProblemBodyShape()
    {
        IReadOnlyList<ConcealingEndpointFact> declaring404 =
        [
            .. _endpoints.Endpoints
                .Where(static endpoint => endpoint.Endpoint.Declares(StatusCodes.Status404NotFound)),
        ];

        // Both populations have to be present, or "they share one shape" would be a statement about one
        // of them. A concealing endpoint declaring 404 is the subject; an ordinary one is the benchmark.
        Assert.Contains(declaring404, static endpoint => endpoint.ConcealsExistence);
        Assert.Contains(declaring404, static endpoint => !endpoint.ConcealsExistence);

        IReadOnlyList<Type> bodyTypes =
        [
            .. declaring404
                .SelectMany(static endpoint => endpoint.Endpoint.DeclaredResponses)
                .Where(static response => response.Status == StatusCodes.Status404NotFound)
                .Select(static response => response.BodyType)
                .OfType<Type>()
                .Distinct(),
        ];

        Type shape = Assert.Single(bodyTypes);
        Assert.Equal(typeof(ProblemDetails), shape);
    }

    /// <summary>
    /// The non-vacuity floor. Without it every assertion above would be satisfied by an empty set,
    /// which is exactly what a regression in the catalogue would produce: the guard would go green at
    /// the moment it stopped having a subject.
    /// <para>
    /// All five concealing seams are present; each contributes at least
    /// <see cref="ConcealingSeams.MinimumConcealedFailuresPerSeam"/> masked failures and therefore at
    /// least one pair; each seam's failures stand for genuinely <i>distinct</i> causes, so identity is
    /// not being asserted between two copies of one input; and every concealed body is a non-empty JSON
    /// object carrying several members, so byte-equality is not holding because both bodies are empty.
    /// </para>
    /// </summary>
    [Fact]
    public void TheDiscoveredConcealingSeamSetIsNonVacuous()
    {
        Assert.Equal(ConcealingSeams.DeclaredConcealingSeamCount, ConcealingSeams.SeamNames.Count);
        Assert.NotEmpty(_catalogue.Pairs);

        foreach (string seamName in ConcealingSeams.SeamNames)
        {
            IReadOnlyList<CapturedResponse> concealed = _catalogue.ConcealedBy(seamName);

            Assert.True(
                concealed.Count >= ConcealingSeams.MinimumConcealedFailuresPerSeam,
                $"{seamName} contributed {concealed.Count} concealed failures; at least "
                    + $"{ConcealingSeams.MinimumConcealedFailuresPerSeam} are needed for the pairwise "
                    + "comparison to say anything.");

            Assert.NotEmpty(_catalogue.PairsOf(seamName));

            // Distinct causes: comparing one input with itself would make identity trivially true.
            int distinctCauses = concealed
                .Select(static response => response.Failure.Cause)
                .Distinct(StringComparer.Ordinal)
                .Count();

            Assert.True(
                distinctCauses >= ConcealingSeams.MinimumConcealedFailuresPerSeam,
                $"{seamName} masks only {distinctCauses} distinct cause(s); identity across identical "
                    + "inputs is not concealment.");

            foreach (CapturedResponse response in concealed)
            {
                Assert.Equal(StatusCodes.Status404NotFound, response.Status);

                Assert.True(
                    response.RootMemberCount >= 3,
                    $"{response.Failure} wrote a body with {response.RootMemberCount} root member(s): "
                        + $"'{response.BodyText}'. Byte-equality over an empty or near-empty body "
                        + "proves nothing.");
            }
        }
    }

    /// <summary>
    /// The discriminating control for the <c>code</c> half of the rule. For each concealing seam it
    /// takes a real, <i>deliberately</i> code-echoing failure of that same seam — one that is not a
    /// concealed not-found and so rightly carries its branchable code — and requires the rule to report
    /// it, and to report it as differing from that seam's concealed body.
    /// <para>
    /// Without this the rule could be satisfied by any body at all: a walk that found nothing anywhere
    /// would pass every concealed response, and a comparison that found everything equal would pass
    /// every pair.
    /// </para>
    /// </summary>
    [Fact]
    public void TheRuleFailsOnADisclosingResultOfTheSameSeam()
    {
        Assert.Equal(ConcealingSeams.DeclaredConcealingSeamCount, _catalogue.Disclosing.Count);

        foreach (CapturedResponse disclosing in _catalogue.Disclosing)
        {
            Assert.NotEmpty(disclosing.CodeMemberPaths);

            CapturedResponse concealed = _catalogue.ConcealedBy(disclosing.SeamName)[0];

            IReadOnlyList<string> offences = Offences(
                [new ConcealedPair(disclosing.SeamName, concealed, disclosing)]);

            Assert.Contains(
                offences,
                offence => offence.Contains(disclosing.Failure.Producer, StringComparison.Ordinal)
                    && offence.Contains("code", StringComparison.Ordinal));

            Assert.NotEqual(concealed.Body, disclosing.Body);
        }
    }

    /// <summary>
    /// The discriminating control for the identity half: two bodies that differ only in their
    /// <c>detail</c> — the exact shape of a seam that has started echoing the error's message — are
    /// reported, naming both producers.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnConcealedBodiesThatDifferOnlyInTheirDetail()
    {
        CapturedResponse clean = _catalogue.Concealed[0];
        var leaking = new CapturedResponse(
            new ConcealedFailure(
                clean.SeamName,
                "a seam echoing the error message",
                "the squad does not exist",
                static () => TypedResults.Problem(statusCode: StatusCodes.Status404NotFound)),
            clean.Status,
            Encoding.UTF8.GetBytes(
                """{"title":"Not Found","status":404,"detail":"The squad does not exist."}"""));

        IReadOnlyList<string> offences = Offences(
            [new ConcealedPair(clean.SeamName, clean, leaking)]);

        Assert.Contains(
            offences,
            offence => offence.Contains(clean.Failure.Producer, StringComparison.Ordinal)
                && offence.Contains(leaking.Failure.Producer, StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the walk's depth and its precision: a <c>code</c> member nested inside an object
    /// inside an array is found, and members that merely contain the word are not mistaken for it. A
    /// root-only walk would pass the first; a substring match would fail the second and make the rule
    /// unsatisfiable for honest reasons.
    /// </summary>
    [Fact]
    public void TheCodeWalkFindsANestedCodeMemberAndNothingThatMerelyResemblesOne()
    {
        IReadOnlyList<string> nested = CapturedResponse.FindCodeMembers(
            Encoding.UTF8.GetBytes(
                """{"title":"Not Found","errors":[{"code":"Unauthorized"}]}"""));

        Assert.Contains(nested, path => path.Contains("code", StringComparison.Ordinal));

        IReadOnlyList<string> lookAlikes = CapturedResponse.FindCodeMembers(
            Encoding.UTF8.GetBytes(
                """{"codex":"x","encoded":"y","statusCodes":[404],"nested":{"barcode":"z"}}"""));

        Assert.Empty(lookAlikes);
    }

    /// <summary>
    /// Applies the rule to each pair and returns one message per offence, each naming the seam, both
    /// producers, the causes they stand for and the fact at fault.
    /// </summary>
    /// <param name="pairs">The pairs to check.</param>
    /// <returns>Every offence found.</returns>
    private static IReadOnlyList<string> Offences(IEnumerable<ConcealedPair> pairs)
    {
        var offences = new List<string>();

        foreach (ConcealedPair pair in pairs)
        {
            if (pair.Left.Status != pair.Right.Status)
            {
                offences.Add(
                    $"{pair} answer with different statuses ({pair.Left.Status} vs "
                        + $"{pair.Right.Status}); the concealed causes are distinguishable by status "
                        + "alone.");
            }
            else if (pair.Left.Status != StatusCodes.Status404NotFound)
            {
                offences.Add(
                    $"{pair} answer with {pair.Left.Status} rather than 404; a concealed failure is "
                        + "reported as a not-found.");
            }

            if (!pair.Left.Body.SequenceEqual(pair.Right.Body))
            {
                offences.Add(
                    $"{pair} write different bodies: '{pair.Left.BodyText}' vs "
                        + $"'{pair.Right.BodyText}'; the concealed cause is recoverable from the body.");
            }

            foreach (CapturedResponse response in new[] { pair.Left, pair.Right })
            {
                IReadOnlyList<string> codePaths = response.CodeMemberPaths;

                if (codePaths.Count > 0)
                {
                    offences.Add(
                        $"{response.Failure} writes a concealed 404 carrying a 'code' member at "
                            + $"{string.Join(", ", codePaths)}: '{response.BodyText}'. The code names "
                            + "the cause the response exists to conceal.");
                }
            }
        }

        return [.. offences.Distinct(StringComparer.Ordinal)];
    }

    /// <summary>Renders every offender in one message, so the output is a worklist.</summary>
    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));
}
