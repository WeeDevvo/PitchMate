using System.Globalization;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Http;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 5 — Error-seam behaviour is preserved apart from the one corrected
/// code</b>.
/// <para>
/// <b>Validates: Requirements 1.8, 2.12</b>
/// </para>
/// <para>
/// This chore's subject is response <i>metadata</i>: 67 endpoints gained <c>Produces</c> declarations
/// and six seams gained a convention class. None of that is supposed to change what a client receives
/// when something fails. But the same pass also switched every seam from <c>Results.Problem</c> to
/// <c>TypedResults.Problem</c>, rewrote three concealing arms, and corrected one status — and the way a
/// change like that goes wrong is not dramatically. It goes wrong as a <c>409</c> that quietly became a
/// <c>400</c> on one of seventy-five codes, in a seam nobody's integration test drives, discovered by a
/// client six weeks later.
/// </para>
/// <para>
/// So the expectation is written down independently, in <see cref="SeamBehaviourBaseline"/>, read off
/// the six <c>*ErrorResults</c> files at their pre-change revision. A guard that recomputed what the
/// seam does today would pass whatever the seam does; a table cannot. Drift surfaces as a failing
/// comparison whose only honest resolution is editing a row — a decision, in a diff, with a reviewer.
/// </para>
/// <para>
/// <b>The quantification</b> covers every error code of every seam variant except
/// <see cref="SeamBehaviourBaseline.CorrectedCodeName"/> — the status correction Requirement 6 makes and
/// Requirement 2.12 exempts by name. The codes come from <see cref="ProblemSeams"/>, which enumerates
/// them by reflection, so a code added next year arrives with no baseline row and
/// <see cref="TheBaselineCoversExactlyTheDrivenCodes"/> says so rather than passing over it.
/// </para>
/// <para>
/// <b>The two recorded deviations</b> are set out in full on <see cref="SeamBehaviourBaseline"/>: the
/// <c>AlreadyMember</c> correction of design D5, and the three concealing arms that task 11.1 moved off
/// a code-carrying <c>404</c> onto their seam's fixed <c>Concealed()</c> result. Both are held to their
/// reasons here — <see cref="TheRecordedDeviationsAreExactlyTheDecidedOnes"/> pins the set,
/// <see cref="TheCorrectedCodeIsACodeCarryingConflict"/> pins the first against Requirement 6.1, and
/// <see cref="TheConcealedDeviationsEmitTheirSeamsFixedConcealedBody"/> pins the second against
/// Requirements 5.2 and 5.6.
/// </para>
/// <para>
/// What this guard does not speak about: that the concealed bodies are indistinguishable from one
/// another is <see cref="ConcealmentProperties"/>'s subject, and that non-concealed bodies each carry
/// their own code is <see cref="BranchableCodeProperties"/>'s. This one is about whether any of it
/// <i>moved</i>.
/// </para>
/// </summary>
public sealed class SeamBehaviourPreservationProperties : IClassFixture<ProblemCodeCatalogue>
{
    /// <summary>
    /// The non-vacuity floor on the driven codes. 75 are reachable today across the eight seam
    /// variants, held at 70 so the floor is a floor rather than a restatement of today's count.
    /// </summary>
    private const int MinimumDrivenCodeCount = 70;

    /// <summary>
    /// The floor on the population the rule ranges over, after the one corrected code is carved out.
    /// 73 are in scope today.
    /// </summary>
    private const int MinimumInScopeCodeCount = 68;

    /// <summary>The member order <c>ProblemDetails</c> serialises, for failure messages.</summary>
    private const string ExpectedMemberOrder = "type, title, status, detail, code";

    private readonly ProblemCodeCatalogue _codes;
    private readonly IReadOnlyList<SeamProblem> _inScope;
    private readonly IReadOnlyList<SeamProblem> _carvedOut;

    /// <summary>Receives the captured seam responses and splits off the one corrected code.</summary>
    /// <param name="codes">The captured and classified seam responses.</param>
    public SeamBehaviourPreservationProperties(ProblemCodeCatalogue codes)
    {
        ArgumentNullException.ThrowIfNull(codes);

        _codes = codes;
        _inScope = [.. codes.Problems.Where(SeamBehaviourBaseline.IsInScope)];
        _carvedOut = [.. codes.Problems.Where(static problem => !SeamBehaviourBaseline.IsInScope(problem))];
    }

    // Feature: api-response-contracts, Property 5: Error-seam behaviour is preserved apart from the one
    // corrected code — for any error code of any subsystem other than AlreadyMember, the status and
    // ProblemDetails body the seam produces equal the status and body recorded for it in the
    // pre-change baseline.
    // Validates: Requirements 1.8, 2.12
    [Property(MaxTest = 300)]
    [Trait("Property", "5")]
    public Property Property5_ErrorSeamBehaviourIsPreservedApartFromTheOneCorrectedCode() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(_inScope.ToArray())),
            (SeamProblem problem) =>
            {
                IReadOnlyList<string> offences = Offences([problem]);

                return (offences.Count == 0)
                    .ToProperty()
                    .Label(string.Join("; ", offences))
                    .Collect(problem.SeamVariant);
            });

    /// <summary>
    /// The exhaustive companion to the property. The driven codes are a finite discovered set, so
    /// exhausting them is strictly stronger than sampling them, and a failure reports <i>every</i>
    /// drifted code as a worklist rather than the single shrunk counterexample a property failure
    /// yields.
    /// </summary>
    [Fact]
    public void EveryInScopeCodeStillProducesItsPreChangeStatusAndBody()
    {
        IReadOnlyList<string> offences = Offences(_inScope);

        Assert.True(offences.Count == 0, Report("seam behaviours that moved", offences));
    }

    /// <summary>
    /// The table and the driven codes describe the same surface. A row with no driven code is a stale
    /// expectation; a driven code with no row is an error code that entered the surface without anyone
    /// deciding what it should answer — the second being the failure that matters, because it is the one
    /// that would otherwise go unexamined.
    /// </summary>
    [Fact]
    public void TheBaselineCoversExactlyTheDrivenCodes()
    {
        IReadOnlyList<string> driven =
        [
            .. _codes.Problems
                .Select(static problem => $"{problem.SeamVariant}|{problem.CodeName}")
                .Order(StringComparer.Ordinal),
        ];

        IReadOnlyList<string> tabulated =
        [
            .. SeamBehaviourBaseline.Rows
                .Select(static row => row.Key)
                .Order(StringComparer.Ordinal),
        ];

        IReadOnlyList<string> undeclared = [.. driven.Except(tabulated, StringComparer.Ordinal)];
        IReadOnlyList<string> stale = [.. tabulated.Except(driven, StringComparer.Ordinal)];

        Assert.True(
            undeclared.Count == 0,
            Report(
                "driven error codes with no baseline row — each needs a deliberate decision about the "
                    + "status and body it answers with, recorded in SeamBehaviourBaseline",
                undeclared));

        Assert.True(
            stale.Count == 0,
            Report("baseline rows no longer driven by any seam", stale));

        Assert.Equal(SeamBehaviourBaseline.Rows.Count, SeamBehaviourBaseline.ByKey.Count);
    }

    /// <summary>
    /// Pins the departing set. The rows that depart are derived from the table; this asserts they are
    /// exactly the five that were decided — so a regression cannot be sanctioned after the fact by
    /// adding a <c>PreChange</c> note to the row it broke, which is otherwise the path of least
    /// resistance when this guard goes red.
    /// </summary>
    [Fact]
    public void TheRecordedDeviationsAreExactlyTheDecidedOnes()
    {
        IReadOnlyList<string> measured =
        [
            .. SeamBehaviourBaseline.Rows
                .Where(static row => row.IsDeviation)
                .Select(static row => row.Key)
                .Order(StringComparer.Ordinal),
        ];

        Assert.Equal(
            SeamBehaviourBaseline.DeclaredDeviations.Order(StringComparer.Ordinal).ToArray(), measured);

        // Each of the five says what it departed from, in prose a reviewer can weigh.
        Assert.All(
            SeamBehaviourBaseline.Rows.Where(static row => row.IsDeviation),
            static row => Assert.False(
                string.IsNullOrWhiteSpace(row.PreChange),
                $"{row.Description} is marked as a deviation but records nothing about what it "
                    + "departed from."));

        // And the two groups partition the five: the corrected code, and the concealment correction.
        IReadOnlyList<string> corrected =
        [
            .. measured.Except(SeamBehaviourBaseline.ConcealmentCorrections, StringComparer.Ordinal),
        ];

        Assert.All(
            corrected,
            static key => Assert.EndsWith(
                $"|{SeamBehaviourBaseline.CorrectedCodeName}", key, StringComparison.Ordinal));
    }

    /// <summary>
    /// The carve-out is exactly the one code Requirement 2.12 exempts, in both squad variants, and
    /// nothing else. A carve-out that widened would be the quiet way to make this guard say less than it
    /// claims.
    /// </summary>
    [Fact]
    public void TheCarveOutIsExactlyTheOneCorrectedCode()
    {
        Assert.NotEmpty(_carvedOut);

        Assert.All(
            _carvedOut,
            static problem => Assert.Equal(
                SeamBehaviourBaseline.CorrectedCodeName, problem.CodeName));

        Assert.Equal(
            [
                $"SquadErrorResults ({ProblemSeams.Concealed}): "
                    + $"{nameof(SquadErrorCode)}.{SeamBehaviourBaseline.CorrectedCodeName}",
                $"SquadErrorResults ({ProblemSeams.Standard}): "
                    + $"{nameof(SquadErrorCode)}.{SeamBehaviourBaseline.CorrectedCodeName}",
            ],
            _carvedOut.Select(static problem => problem.Description).Order(StringComparer.Ordinal));

        Assert.Equal(_codes.Problems.Count, _inScope.Count + _carvedOut.Count);
    }

    /// <summary>
    /// Deviation 1, held to its reason. The corrected code answers <c>409 Conflict</c> with a problem
    /// body carrying its branchable code — which is Requirement 6.1, and which the pre-change bodiless
    /// <c>200</c> could not do. Carving a code out of the preservation rule does not leave it
    /// unexamined; it moves it under a different rule.
    /// </summary>
    [Fact]
    public void TheCorrectedCodeIsACodeCarryingConflict()
    {
        Assert.NotEmpty(_carvedOut);

        foreach (SeamProblem problem in _carvedOut)
        {
            Assert.Equal(StatusCodes.Status409Conflict, problem.Status);
            Assert.Equal([SeamProblem.RootCodePath], problem.CodeMemberPaths);
            Assert.Equal(SeamBehaviourBaseline.CorrectedCodeName, problem.CodeExtension);
            Assert.False(problem.IsConcealedNotFound);
        }
    }

    /// <summary>
    /// Deviation 2, held to its reason. The three arms task 11.1 rewrote are byte-for-byte their seam's
    /// own fixed <c>Concealed()</c> result — not merely "a 404", and not a 404 of their own invention.
    /// That is the whole justification for recording the concealed body in the baseline instead of the
    /// pre-fix code-carrying one: Requirement 2.11 carves concealed not-founds out of the code-extension
    /// rule, and Requirements 5.2 and 5.6 forbid the code there, so the specific rule beats 2.12's
    /// general preservation rule. Preserving the pre-fix body would have required this guard to assert a
    /// disclosure.
    /// </summary>
    [Fact]
    public async Task TheConcealedDeviationsEmitTheirSeamsFixedConcealedBody()
    {
        Dictionary<string, Func<IResult>> concealedResults = new(StringComparer.Ordinal)
        {
            [$"SquadErrorResults ({ProblemSeams.Concealed})"] = SquadErrorResults.Concealed,
            [$"MatchErrorResults ({ProblemSeams.Concealed})"] = MatchErrorResults.Concealed,
            [$"NotificationErrorResults ({ProblemSeams.Standard})"] = NotificationErrorResults.Concealed,
        };

        Assert.Equal(
            SeamBehaviourBaseline.ConcealmentCorrections.Count, concealedResults.Count);

        foreach (string key in SeamBehaviourBaseline.ConcealmentCorrections)
        {
            SeamBehaviourExpectation row = SeamBehaviourBaseline.ByKey[key];
            string seamVariant = row.SeamVariant;

            SeamProblem problem = Assert.Single(
                _inScope,
                candidate =>
                    string.Equals(candidate.SeamVariant, seamVariant, StringComparison.Ordinal)
                        && string.Equals(candidate.CodeName, row.CodeName, StringComparison.Ordinal));

            // The body carries no branchable code at all (Requirements 5.2, 5.6) — the pre-fix body
            // carried one naming the very cause the response exists to conceal.
            Assert.Empty(problem.CodeMemberPaths);

            // And it is the seam's one fixed result, so it cannot drift away from the other failures
            // that seam conceals behind the same bytes.
            Assert.True(
                problem.IsConcealedNotFound,
                $"{problem.Description} is recorded as routed through its seam's Concealed() result "
                    + $"but does not produce those bytes: '{problem.BodyText}'.");

            CapturedResponse reference = await CapturedResponse.CaptureAsync(
                new ConcealedFailure(
                    seamVariant,
                    $"{seamVariant}.Concealed()",
                    "the reference concealed not-found",
                    concealedResults[seamVariant]));

            Assert.Equal(reference.Status, problem.Status);
            Assert.Equal(reference.BodyText, problem.BodyText);
        }
    }

    /// <summary>
    /// The non-vacuity floor. Without it every assertion above would be satisfied by an empty set, which
    /// is exactly what a seam-discovery regression produces: the guard would go green at the moment it
    /// stopped having a subject.
    /// <para>
    /// All six seams and all eight variants are present; at least
    /// <see cref="MinimumDrivenCodeCount"/> codes were driven and at least
    /// <see cref="MinimumInScopeCodeCount"/> survive the carve-out; the table spans the whole status
    /// range the six seams between them emit, so preservation is a claim about the surface rather than
    /// about one status; and the message handed to every seam is one non-empty string that is not the
    /// concealed detail, so "detail echoes the cause" is a real comparison rather than two constants
    /// that happen to match.
    /// </para>
    /// </summary>
    [Fact]
    public void TheDrivenCodeSetIsNonVacuous()
    {
        Assert.Equal(ProblemSeams.DeclaredSeamCount, ProblemSeams.SeamNames.Count);
        Assert.Equal(ProblemSeams.DeclaredVariantCount, ProblemSeams.SeamVariants.Count);

        Assert.True(
            _codes.Problems.Count >= MinimumDrivenCodeCount,
            $"Only {_codes.Problems.Count} error codes were driven through their seams; at least "
                + $"{MinimumDrivenCodeCount} are reachable. A rule quantified over nothing holds for "
                + "everything.");

        Assert.True(
            _inScope.Count >= MinimumInScopeCodeCount,
            $"Only {_inScope.Count} driven codes are inside the preservation rule; at least "
                + $"{MinimumInScopeCodeCount} are. A carve-out that swallowed the population would "
                + "leave the rule with nothing to say.");

        IReadOnlyList<int> statuses =
        [
            .. SeamBehaviourBaseline.Rows.Select(static row => row.Status).Distinct().Order(),
        ];

        Assert.Equal(
            [400, 401, 403, 404, 409, 410, 500, 502, 503],
            statuses);

        // Every row's expected detail resolves, and the cause handed to the seams is a single non-empty
        // string distinct from the fixed concealed detail — so a seam that started echoing the cause
        // into a concealed body could not pass by coincidence.
        IReadOnlyList<string> causes =
        [
            .. _codes.Problems
                .Select(static problem => problem.Response.Failure.Cause)
                .Distinct(StringComparer.Ordinal),
        ];

        string cause = Assert.Single(causes);
        Assert.False(string.IsNullOrWhiteSpace(cause));
        Assert.NotEqual(SeamBehaviourBaseline.ConcealedDetail, cause);
        Assert.NotEqual(SeamBehaviourBaseline.ComputationFailedDetail, cause);
    }

    /// <summary>
    /// The per-variant half of the floor: each (seam, variant) pairing drove <b>every</b> member its
    /// error-code enum reports, so no code was enumerated and then skipped — the failure that would let
    /// a brand-new code slip past the rule while the counts above still looked healthy.
    /// </summary>
    /// <param name="seamVariant">The pairing under test.</param>
    [Theory]
    [MemberData(nameof(AllSeamVariants))]
    public void EverySeamVariantIsFullyTabulated(string seamVariant)
    {
        Type errorCodeType = ProblemSeams.ErrorCodeTypeOf(seamVariant);

        IReadOnlyList<SeamBehaviourExpectation> rows =
        [
            .. SeamBehaviourBaseline.Rows
                .Where(row => string.Equals(row.SeamVariant, seamVariant, StringComparison.Ordinal)),
        ];

        Assert.Equal(Enum.GetValues(errorCodeType).Length, rows.Count);

        foreach (string codeName in Enum.GetNames(errorCodeType))
        {
            Assert.Contains(
                rows, row => string.Equals(row.CodeName, codeName, StringComparison.Ordinal));
        }
    }

    /// <summary>Every discovered (seam, variant) pairing, for the exhaustive floor above.</summary>
    /// <returns>One case per pairing.</returns>
    public static TheoryData<string> AllSeamVariants()
    {
        var data = new TheoryData<string>();

        foreach (string seamVariant in ProblemSeams.SeamVariants)
        {
            data.Add(seamVariant);
        }

        return data;
    }

    /// <summary>
    /// The positive control: the real responses the real seams produce are reported clean. Paired with
    /// the negative controls below, it shows the rule discriminates rather than either complaining
    /// indiscriminately or accepting anything.
    /// </summary>
    [Fact]
    public void TheRulePassesOnTheRealSeamResponses()
    {
        Assert.NotEmpty(_inScope);
        Assert.Empty(Offences(_inScope));
    }

    /// <summary>
    /// The discriminating control for the status half: a response whose status moved — the single most
    /// likely way this change breaks a client, and one no body comparison would notice — is reported,
    /// naming the code, the expected status and the one it found.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnADriftedStatus()
    {
        SeamProblem honest = Honest(StatusCodes.Status409Conflict);
        SeamProblem drifted = honest with
        {
            Response = new CapturedResponse(
                honest.Response.Failure, StatusCodes.Status400BadRequest, honest.Response.Body),
        };

        IReadOnlyList<string> offences = Offences([drifted]);

        Assert.Contains(
            offences,
            offence => offence.Contains(drifted.Description, StringComparison.Ordinal)
                && offence.Contains("409", StringComparison.Ordinal)
                && offence.Contains("400", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the body half: a title that moved is reported. <c>title</c> is the member a
    /// reworded seam is most likely to touch, and the one a client surfacing the problem to a user would
    /// show.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnADriftedTitle()
    {
        SeamProblem honest = Honest(StatusCodes.Status409Conflict);
        SeamProblem drifted = Rewritten(
            honest, Replacing(honest, "title", "Conflict"));

        IReadOnlyList<string> offences = Offences([drifted]);

        Assert.Contains(
            offences,
            offence => offence.Contains(drifted.Description, StringComparison.Ordinal)
                && offence.Contains("title", StringComparison.Ordinal)
                && offence.Contains("Conflict", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for a dropped <c>code</c> extension — the regression a status-only check would pass
    /// over entirely, and the one that leaves a client parsing English.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnADroppedCodeExtension()
    {
        SeamProblem honest = Honest(StatusCodes.Status409Conflict);
        SeamProblem drifted = Rewritten(
            honest,
            [
                .. Members(honest)
                    .Where(static member => !string.Equals(member.Key, "code", StringComparison.Ordinal)),
            ]);

        IReadOnlyList<string> offences = Offences([drifted]);

        Assert.Contains(
            offences,
            offence => offence.Contains(drifted.Description, StringComparison.Ordinal)
                && offence.Contains("code", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for an <i>added</i> member. A body that gained a field is still a changed body — it
    /// is how a diagnostic leaks onto the wire — so the comparison is over the whole member set and its
    /// order, not a subset check.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAnAddedMember()
    {
        SeamProblem honest = Honest(StatusCodes.Status409Conflict);
        SeamProblem drifted = Rewritten(
            honest,
            [
                .. Members(honest),
                new KeyValuePair<string, string>("traceId", "00-abc-def-01"),
            ]);

        IReadOnlyList<string> offences = Offences([drifted]);

        Assert.Contains(
            offences,
            offence => offence.Contains(drifted.Description, StringComparison.Ordinal)
                && offence.Contains("traceId", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the one defect the <c>code</c> and <c>title</c> checks would both miss: a
    /// concealed <c>404</c> that started echoing the cause as its <c>detail</c>. The baseline records a
    /// fixed detail for those rows precisely so that this is a failure rather than an improvement in
    /// helpfulness.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAConcealedBodyEchoingItsCause()
    {
        SeamProblem concealed = Assert.Single(
            _inScope,
            static problem =>
                problem.IsConcealedNotFound
                    && string.Equals(
                        problem.SeamVariant,
                        $"StatsErrorResults ({ProblemSeams.Standard})",
                        StringComparison.Ordinal)
                    && string.Equals(problem.CodeName, "NotFound", StringComparison.Ordinal));

        SeamProblem leaking = Rewritten(
            concealed, Replacing(concealed, "detail", concealed.Response.Failure.Cause));

        IReadOnlyList<string> offences = Offences([leaking]);

        Assert.Contains(
            offences,
            offence => offence.Contains(leaking.Description, StringComparison.Ordinal)
                && offence.Contains("detail", StringComparison.Ordinal));
    }

    /// <summary>
    /// Applies the rule to each driven code and returns one message per offence, each naming the seam,
    /// the variant, the producing code and the fact at fault.
    /// </summary>
    /// <param name="problems">The driven codes to check.</param>
    /// <returns>Every offence found.</returns>
    private static IReadOnlyList<string> Offences(IEnumerable<SeamProblem> problems)
    {
        var offences = new List<string>();

        foreach (SeamProblem problem in problems)
        {
            SeamBehaviourExpectation? expectation = SeamBehaviourBaseline.For(problem);

            if (expectation is null)
            {
                offences.Add(
                    $"{problem.Description} has no row in the pre-change baseline, so there is nothing "
                        + "to preserve it against. An error code reaching the wire needs a deliberate "
                        + "decision about the status and body it answers with, recorded in "
                        + "SeamBehaviourBaseline.");

                continue;
            }

            if (problem.Status != expectation.Status)
            {
                offences.Add(
                    $"{problem.Description} answers {problem.Status} where it answered "
                        + $"{expectation.Status} before this change: '{problem.BodyText}'. A moved "
                        + "status is a broken client.");
            }

            IReadOnlyList<KeyValuePair<string, string>> expected =
                expectation.ExpectedMembers(problem.Response.Failure.Cause);
            IReadOnlyList<KeyValuePair<string, string>> actual = RootMembers(problem.Response.Body);

            offences.AddRange(BodyOffences(problem, expected, actual));
        }

        return [.. offences.Distinct(StringComparer.Ordinal)];
    }

    /// <summary>
    /// Compares the body's root members with the expected ones, by name, by value, and in order — the
    /// three ways a serialised body can differ while every individual member looks reasonable.
    /// </summary>
    private static IReadOnlyList<string> BodyOffences(
        SeamProblem problem,
        IReadOnlyList<KeyValuePair<string, string>> expected,
        IReadOnlyList<KeyValuePair<string, string>> actual)
    {
        var offences = new List<string>();

        string[] expectedNames = [.. expected.Select(static member => member.Key)];
        string[] actualNames = [.. actual.Select(static member => member.Key)];

        foreach (string added in actualNames.Except(expectedNames, StringComparer.Ordinal))
        {
            offences.Add(
                $"{problem.Description} writes a '{added}' member its pre-change body did not: "
                    + $"'{problem.BodyText}'. An added member is a changed body.");
        }

        foreach (string removed in expectedNames.Except(actualNames, StringComparer.Ordinal))
        {
            offences.Add(
                $"{problem.Description} no longer writes the '{removed}' member its pre-change body "
                    + $"carried: '{problem.BodyText}'.");
        }

        foreach (KeyValuePair<string, string> member in expected)
        {
            int index = Array.IndexOf(actualNames, member.Key);

            if (index < 0)
            {
                continue;
            }

            if (!string.Equals(actual[index].Value, member.Value, StringComparison.Ordinal))
            {
                offences.Add(
                    $"{problem.Description} writes '{member.Key}' as '{actual[index].Value}' where it "
                        + $"wrote '{member.Value}' before this change: '{problem.BodyText}'.");
            }
        }

        if (expectedNames.Length == actualNames.Length
            && !expectedNames.SequenceEqual(actualNames, StringComparer.Ordinal))
        {
            offences.Add(
                $"{problem.Description} writes its members as {string.Join(", ", actualNames)} rather "
                    + $"than {ExpectedMemberOrder}: '{problem.BodyText}'. A reordered body is a "
                    + "different body on the wire.");
        }

        return offences;
    }

    /// <summary>The root members of a JSON body, in document order, values rendered as text.</summary>
    private static IReadOnlyList<KeyValuePair<string, string>> RootMembers(byte[] body)
    {
        if (body.Length == 0)
        {
            return [];
        }

        using JsonDocument document = JsonDocument.Parse(body);

        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        return
        [
            .. document.RootElement.EnumerateObject()
                .Select(static property => new KeyValuePair<string, string>(
                    property.Name,
                    property.Value.ValueKind == JsonValueKind.String
                        ? property.Value.GetString() ?? string.Empty
                        : property.Value.GetRawText())),
        ];
    }

    /// <summary>
    /// A real, in-scope, code-echoing response of the given status, for the controls to mutate — so each
    /// control presents the rule with a defect grafted onto something the seams genuinely produce rather
    /// than onto a hand-built fiction.
    /// </summary>
    private SeamProblem Honest(int status) =>
        _inScope.First(problem =>
            problem.Status == status
                && !problem.IsConcealedNotFound
                && problem.CodeMemberPaths.Count == 1
                && SeamBehaviourBaseline.For(problem)?.IsDeviation == false);

    /// <summary>The root members of a real response, as a mutable starting point for a control.</summary>
    private static IReadOnlyList<KeyValuePair<string, string>> Members(SeamProblem problem) =>
        RootMembers(problem.Response.Body);

    /// <summary>That same member list with one member's value replaced.</summary>
    private static IReadOnlyList<KeyValuePair<string, string>> Replacing(
        SeamProblem problem,
        string name,
        string value) =>
        [
            .. Members(problem)
                .Select(member => string.Equals(member.Key, name, StringComparison.Ordinal)
                    ? new KeyValuePair<string, string>(name, value)
                    : member),
        ];

    /// <summary>
    /// The same driven code with a re-serialised body, so a control can present the rule with a defect
    /// the real seams do not produce while keeping every other fact about the problem intact. Going
    /// through a writer rather than editing the body text means a control cannot silently become a
    /// no-op because the serialiser spaced a member differently than the control's string match assumed.
    /// </summary>
    private static SeamProblem Rewritten(
        SeamProblem problem,
        IReadOnlyList<KeyValuePair<string, string>> members)
    {
        using var buffer = new MemoryStream();

        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();

            foreach (KeyValuePair<string, string> member in members)
            {
                if (string.Equals(member.Key, "status", StringComparison.Ordinal)
                    && int.TryParse(member.Value, CultureInfo.InvariantCulture, out int status))
                {
                    writer.WriteNumber(member.Key, status);
                }
                else
                {
                    writer.WriteString(member.Key, member.Value);
                }
            }

            writer.WriteEndObject();
        }

        return problem with
        {
            Response = new CapturedResponse(problem.Response.Failure, problem.Status, buffer.ToArray()),
        };
    }

    /// <summary>Renders every offender in one message, so the output is a worklist.</summary>
    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));
}
