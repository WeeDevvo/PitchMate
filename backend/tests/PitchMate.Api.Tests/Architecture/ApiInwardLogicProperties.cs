using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// <b>Property 21 — The Api layer stays free of inward logic.</b>
/// <para>
/// <b>Validates: Requirements 11.2, 11.6</b>
/// </para>
/// <para>
/// <i>For any</i> type in the <c>PitchMate.Api</c> assembly, that type is neither a use-case handler
/// nor an entity type configuration and contains no rating or aggregation arithmetic; and <i>for any</i>
/// source file in <c>PitchMate.Api</c> or <c>PitchMate.Infrastructure</c>, that file contains no
/// σ-threshold comparison — with a positive control confirming the scan does find that comparison
/// where the Domain-declared rule is legitimately implemented.
/// </para>
/// <para>
/// <b>Why this is stated exhaustively rather than generatively.</b> Both populations the property
/// quantifies over are finite and discoverable: the types an assembly reports, and the production C#
/// files two project directories hold. Exhausting a finite population is strictly stronger than
/// sampling it, so the two universal halves are theories over the real catalogues rather than FsCheck
/// generators — in the idiom of
/// <see cref="PitchMate.Api.Tests.Contracts.EndpointSuccessDeclarationProperties"/>, and using
/// <see cref="System.Reflection"/> and the file system only, adding no test package (Requirement 11.8).
/// Crucially both populations are <i>discovered</i>, never listed here, so a type or file added next
/// year enters the assertion without this test being edited.
/// </para>
/// <para>
/// <b>Why it cannot pass vacuously.</b> An exhaustive check over a discovered population has exactly
/// one failure mode: discovering nothing. Three things close it.
/// </para>
/// <list type="number">
/// <item><b>Explicit floors</b> under each population —
/// <see cref="TheQuantifiedTypePopulationIsNonVacuous"/> requires at least
/// <see cref="MinimumApiTypeCount"/> types and that the real transport surface is among them;
/// <see cref="TheQuantifiedSourcePopulationIsNonVacuous"/> requires at least
/// <see cref="MinimumScannedSourceFileCount"/> files, drawn from both scanned projects, each holding
/// readable lines (Requirement 11.7).</item>
/// <item>The <b>positive control</b> of the source half
/// (<see cref="SourceScan_FindsTheDomainDeclaredComparisonInTheAllowListedImplementation"/>): the scan's
/// patterns do match the real comparison in the one allow-listed file that implements the
/// Domain-declared <c>IRatingEngine.GetState</c> contract, so a clean negative half means no second
/// comparison rather than patterns that match nothing anywhere.</item>
/// <item>The <b>planted controls</b> of the type half
/// (<see cref="EachWayOfBreakingTheTypeRuleIsReportedNamingTheType"/>): a handler, an entity
/// configuration, and a rating carrier are planted in the <em>test</em> assembly, and the rule must
/// report each by name while reporting a clean transport record at the same time — showing it
/// discriminates rather than returning the empty list for everything.</item>
/// </list>
/// <para>
/// One generative half genuinely adds something the catalogues cannot: the σ-comparison pattern is a
/// regex, and a regex that matched only the one line in the allow-listed file would satisfy the
/// control above while missing every variant an author might write.
/// <see cref="Property21_AnySigmaThresholdComparisonIsDetectedAndNoNearMissIs"/> therefore generates
/// comparisons across σ spellings, qualifying prefixes, relational operators and right-hand sides, and
/// generates the near misses that must <i>not</i> fire (a lambda arrow, a plain mention, a generic
/// argument list).
/// </para>
/// <para>
/// Both halves call the same predicates the 12.1 architecture suites call —
/// <see cref="InwardLogicRule"/> and <see cref="InwardLogicSourceScan"/> — so this property proves the
/// teeth of the rules those suites actually apply, not of a second copy that could drift loose while
/// the suites stayed green.
/// </para>
/// </summary>
public sealed class ApiInwardLogicProperties
{
    /// <summary>
    /// The floor under the type population (Requirement 11.7). The Api assembly declares the six
    /// response conventions, the three transport records, the six endpoint modules and their error
    /// seams, the request contracts of 67 endpoints, and the generated closures of their handler
    /// lambdas — 168 types as this is written. The floor sits comfortably beneath that, so ordinary
    /// churn does not trip it, and far above anything a broken discovery would report.
    /// </summary>
    private const int MinimumApiTypeCount = 120;

    /// <summary>
    /// The floor under the source-file population (Requirement 11.7). <c>PitchMate.Api</c> and
    /// <c>PitchMate.Infrastructure</c> hold 146 authored <c>.cs</c> files between them as this is
    /// written; the floor sits beneath that and well above an empty or single-project scan.
    /// </summary>
    private const int MinimumScannedSourceFileCount = 110;

    private const string ApiAssemblyName = "PitchMate.Api";

    /// <summary>
    /// The anchor creates a hard compile-time link to the asserted assembly, so a renamed or relocated
    /// Api project fails the build rather than letting this property inspect the wrong thing.
    /// </summary>
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>Population one: every type the Api assembly reports, discovered, never listed.</summary>
    private static readonly IReadOnlyList<Type> ApiTypes =
        [.. InwardLogicRule.LoadableTypes(ApiAssembly)];

    /// <summary>
    /// Population two: every production C# file of the two scanned projects, discovered from disk,
    /// never listed.
    /// </summary>
    private static readonly IReadOnlyList<ProductionSourceFile> ScannedSource =
        InwardLogicSourceScan.DiscoverProductionSource();

    /// <summary>
    /// The three ways a type can break the rule, planted in the test assembly so the rule can be shown
    /// to have teeth without putting a defect in production source.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, Type> PlantedDefects =
        new Dictionary<string, Type>(StringComparer.Ordinal)
        {
            ["use-case handler"] = typeof(PlantedUseCaseHandler),
            ["entity type configuration"] = typeof(PlantedEntityTypeConfiguration),
            ["rating or aggregation arithmetic"] = typeof(PlantedRatingArithmetic),
        };

    /// <summary>One case per way of breaking the type rule, named so a failure identifies the defect.</summary>
    /// <returns>The defect names.</returns>
    public static TheoryData<string> AllTypeDefects()
    {
        var data = new TheoryData<string>();

        foreach (string defectName in PlantedDefects.Keys)
        {
            data.Add(defectName);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 21: The Api layer stays free of inward logic.
    // Validates: Requirement 11.2
    /// <summary>
    /// The exhaustive type half: every type the Api assembly reports is neither a use-case handler nor
    /// an entity type configuration, and carries no rating or statistics-aggregation type in any member
    /// signature. Quantified over the discovered set, so a type added under a new Api namespace enters
    /// this assertion unedited.
    /// </summary>
    [Fact]
    public void Property21_EveryTypeInTheApiAssemblyCarriesNoInwardLogic()
    {
        IReadOnlyList<string> violations = InwardLogicRule.Violations(ApiTypes);

        Assert.True(
            violations.Count == 0,
            $"{violations.Count} types in {ApiAssemblyName} carry inward logic "
                + $"(Requirement 11.2):{Environment.NewLine}"
                + string.Join(Environment.NewLine, violations.Select(static v => $"  - {v}")));
    }

    // Feature: api-response-contracts, Property 21: The Api layer stays free of inward logic.
    // Validates: Requirement 11.6
    /// <summary>
    /// The exhaustive source half: no production file of <c>PitchMate.Api</c> or
    /// <c>PitchMate.Infrastructure</c> compares a σ against a threshold, or even reads the
    /// Domain-declared threshold, outside the one allow-listed implementation of the Domain contract.
    /// The classification is obtained from <c>IRatingEngine.GetState</c>, nowhere re-derived.
    /// </summary>
    [Fact]
    public void Property21_NoScannedSourceFileClassifiesByComparingSigmaAgainstAThreshold()
    {
        IReadOnlyList<string> violations = InwardLogicSourceScan.Violations(ScannedSource);

        Assert.True(
            violations.Count == 0,
            $"{violations.Count} source lines classify a rating outside the Domain-declared rule "
                + $"(Requirement 11.6):{Environment.NewLine}"
                + string.Join(Environment.NewLine, violations.Select(static v => $"  - {v}")));
    }

    /// <summary>
    /// Requirement 11.7 — the floor under the type half. At least
    /// <see cref="MinimumApiTypeCount"/> types were quantified over, they all really come from the Api
    /// assembly, and the transport surface this change added is among them. Without this, the
    /// exhaustive half would be satisfied by the empty set, which is exactly what a change to type
    /// discovery produces — and it would go green at the moment it stopped looking at anything.
    /// </summary>
    [Fact]
    public void TheQuantifiedTypePopulationIsNonVacuous()
    {
        Assert.Equal(ApiAssemblyName, ApiAssembly.GetName().Name);

        Assert.True(
            ApiTypes.Count >= MinimumApiTypeCount,
            $"Type discovery found {ApiTypes.Count} types in {ApiAssemblyName}; at least "
                + $"{MinimumApiTypeCount} are declared. A property quantified over nothing holds for "
                + "everything.");

        Assert.All(ApiTypes, type => Assert.Equal(ApiAssemblyName, type.Assembly.GetName().Name));

        // The real transport surface is inside the population, so the half above is judging the types
        // the change actually added rather than an incidental subset.
        Assert.Contains(typeof(PitchMate.Api.HealthResponse), ApiTypes);
        Assert.Contains(typeof(PitchMate.Api.Notifications.Endpoints.UnreadCountResponse), ApiTypes);
        Assert.Contains(typeof(PitchMate.Api.Notifications.Endpoints.MarkAllReadResponse), ApiTypes);
        Assert.Contains(typeof(PitchMate.Api.Squads.Endpoints.SquadResponseConventions), ApiTypes);
        Assert.Contains(typeof(PitchMate.Api.Stats.Endpoints.StatsResponseConventions), ApiTypes);
    }

    /// <summary>
    /// Requirement 11.7 — the floor under the source half. At least
    /// <see cref="MinimumScannedSourceFileCount"/> files were quantified over, both scanned projects
    /// are represented, every file yielded readable lines, and the allow-listed implementation is among
    /// the discovered files rather than silently missing from the walk.
    /// </summary>
    [Fact]
    public void TheQuantifiedSourcePopulationIsNonVacuous()
    {
        Assert.True(
            ScannedSource.Count >= MinimumScannedSourceFileCount,
            $"Source discovery found {ScannedSource.Count} production files across "
                + $"{string.Join(" and ", InwardLogicSourceScan.ScannedProjects)}; at least "
                + $"{MinimumScannedSourceFileCount} exist. A scan over nothing passes for everything.");

        foreach (string project in InwardLogicSourceScan.ScannedProjects)
        {
            Assert.Contains(ScannedSource, file => file.Project == project);
        }

        Assert.All(ScannedSource, file =>
        {
            Assert.NotEmpty(file.Lines);
            Assert.False(Path.IsPathRooted(file.RelativePath));
        });

        foreach (string allowed in InwardLogicSourceScan.SigmaComparisonAllowList)
        {
            Assert.Contains(
                ScannedSource,
                file => string.Equals(file.RelativePath, allowed, StringComparison.OrdinalIgnoreCase)
                    && file.IsSigmaComparisonAllowListed);
        }
    }

    /// <summary>
    /// The positive control of the source half (Requirement 11.7). The scan's patterns do find the
    /// σ-threshold comparison in every allow-listed file — the files implementing the Domain-declared
    /// <c>IRatingEngine.GetState</c> contract, which per the project structure ship in
    /// <c>PitchMate.Infrastructure</c>. Without this, a pattern that matched nothing anywhere would
    /// make the negative half above pass for the wrong reason.
    /// </summary>
    [Fact]
    public void SourceScan_FindsTheDomainDeclaredComparisonInTheAllowListedImplementation()
    {
        foreach (string allowed in InwardLogicSourceScan.SigmaComparisonAllowList)
        {
            ProductionSourceFile file = InwardLogicSourceScan.ReadAllowListedFile(allowed);

            Assert.True(
                InwardLogicSourceScan.HasDomainDeclaredClassification(file),
                $"The scan must find the sigma-threshold comparison in {allowed}, which implements the "
                    + "Domain-declared classification contract; otherwise the negative half of this "
                    + "property passes vacuously (Requirement 11.7).");

            // And the allow-list is what exempts it: the very same file, judged as if it were not
            // allow-listed, is reported — so the exemption is a deliberate carve-out, not the rule
            // failing to see it.
            var asIfNotAllowListed = file with { IsSigmaComparisonAllowListed = false };

            Assert.NotEmpty(InwardLogicSourceScan.Violations(asIfNotAllowListed));
            Assert.Empty(InwardLogicSourceScan.Violations(file));
        }
    }

    /// <summary>
    /// The planted controls of the type half (Requirement 11.7). Each way of breaking the rule is
    /// reported, and the report names the offending type; a clean transport record is reported clean at
    /// the same time, so the rule is shown to discriminate rather than to object indiscriminately.
    /// </summary>
    /// <param name="defectName">The defect under test.</param>
    [Theory]
    [MemberData(nameof(AllTypeDefects))]
    public void EachWayOfBreakingTheTypeRuleIsReportedNamingTheType(string defectName)
    {
        Type planted = PlantedDefects[defectName];

        IReadOnlyList<string> reported = InwardLogicRule.Violations(planted);

        Assert.NotEmpty(reported);
        Assert.All(reported, message => Assert.Contains(planted.FullName!, message, StringComparison.Ordinal));

        // The rule discriminates: a genuine transport record, judged by the same predicate, is clean.
        Assert.Empty(InwardLogicRule.Violations(typeof(PlantedCleanTransportRecord)));
        Assert.Empty(InwardLogicRule.Violations(typeof(PitchMate.Api.HealthResponse)));
    }

    // Feature: api-response-contracts, Property 21: The Api layer stays free of inward logic.
    // Validates: Requirement 11.6
    /// <summary>
    /// The generative half of the source rule: for any σ spelling, any qualifying prefix, any
    /// relational operator and any right-hand side, the line reads as a σ-threshold comparison; and for
    /// any of the near misses an author actually writes — a lambda arrow projecting σ, a plain mention
    /// with no comparison, a generic argument list — it does not.
    /// <para>
    /// This is the conjunct the file catalogue cannot supply. A pattern matching only the single line in
    /// the allow-listed file would satisfy the positive control and still miss a σ comparison written
    /// any other way, leaving the exhaustive half green over a rule with no reach.
    /// </para>
    /// </summary>
    /// <param name="line">The generated line and the verdict it must receive.</param>
    /// <returns>The property.</returns>
    [Property(MaxTest = 500, Arbitrary = new[] { typeof(SigmaComparisonLineGenerators) })]
    public Property Property21_AnySigmaThresholdComparisonIsDetectedAndNoNearMissIs(SigmaComparisonLine line)
    {
        ArgumentNullException.ThrowIfNull(line);

        bool detected = InwardLogicSourceScan.HasSigmaComparison(line.Text);

        return (detected == line.IsComparison)
            .ToProperty()
            .Label($"{line}: detected={detected}, expected={line.IsComparison}")
            .Collect(line.Shape);
    }

    /// <summary>
    /// A planted use-case handler: the <c>Handler</c> suffix is how the sibling suites recognise one,
    /// and a handler is Application work wherever it sits (Requirement 11.2). Test-assembly only — it
    /// is never part of the <c>PitchMate.Api</c> population the exhaustive half judges.
    /// </summary>
    private sealed class PlantedUseCaseHandler
    {
        /// <summary>Stands in for a use case's entry point.</summary>
        /// <returns>Nothing meaningful; the type's shape is the whole point.</returns>
        public static int Handle() => 0;
    }

    /// <summary>
    /// A planted EF Core entity mapping: persistence configuration is Infrastructure work
    /// (Requirement 11.2). Test-assembly only.
    /// </summary>
    private sealed class PlantedEntityTypeConfiguration : IEntityTypeConfiguration<Squad>
    {
        /// <summary>Declares nothing; the implemented interface is the planted defect.</summary>
        /// <param name="builder">The entity type builder.</param>
        public void Configure(EntityTypeBuilder<Squad> builder)
        {
            // Intentionally empty: this type exists to be reported, never to map anything.
        }
    }

    /// <summary>
    /// A planted rating/aggregation carrier: it names the rating engine, a rating, and the standing
    /// source in its surface, which is the reflection-visible proxy for performing that arithmetic
    /// (Requirement 11.2). Test-assembly only.
    /// </summary>
    private sealed class PlantedRatingArithmetic
    {
        private readonly IRatingEngine? _engine;

        /// <summary>Takes the forbidden abstractions, as a type doing the arithmetic would have to.</summary>
        /// <param name="engine">The rating engine.</param>
        /// <param name="standing">The standing source.</param>
        public PlantedRatingArithmetic(IRatingEngine? engine, IMembershipStandingSource? standing)
        {
            _engine = engine;
            Standing = standing;
        }

        /// <summary>The standing source, held so the field and property walks both see a forbidden type.</summary>
        public IMembershipStandingSource? Standing { get; }

        /// <summary>Returns a rating, which a transport type has no business producing.</summary>
        /// <returns>A default rating.</returns>
        public Rating Classify() => new(0.0, 0.0);

        /// <summary>Keeps the engine field read so the compiler does not warn it is unused.</summary>
        /// <returns>Whether an engine was supplied.</returns>
        public bool HasEngine() => _engine is not null;
    }

    /// <summary>
    /// The clean twin: a transport record of exactly the shape the three real ones have. It must be
    /// reported clean by the same predicate that reports the planted defects, which is what makes the
    /// controls evidence of discrimination rather than of indiscriminate complaint.
    /// </summary>
    /// <param name="Count">A wire-shaped scalar.</param>
    private sealed record PlantedCleanTransportRecord(int Count);
}

/// <summary>
/// One generated source line and the verdict <see cref="InwardLogicSourceScan.HasSigmaComparison"/>
/// must give it.
/// </summary>
/// <param name="Text">The line as it would appear in source.</param>
/// <param name="IsComparison">Whether the line is a σ-threshold comparison.</param>
/// <param name="Shape">A label for the shape generated, so failures classify.</param>
public sealed record SigmaComparisonLine(string Text, bool IsComparison, string Shape)
{
    /// <inheritdoc />
    public override string ToString() => $"[{Shape}] {Text}";
}

/// <summary>
/// FsCheck arbitraries for <see cref="SigmaComparisonLine"/>.
/// <para>
/// Comparisons are assembled from the σ spellings the codebase could plausibly use, the qualifying
/// prefixes a member access produces, every relational operator, and both a configured threshold and a
/// bare literal as the right-hand side — so the detector is tested against the variants an author
/// might write rather than against one fixed line. Near misses are the three constructs that look like
/// a comparison to a naive regex: a lambda arrow, a plain mention, and a generic argument list.
/// </para>
/// </summary>
public static class SigmaComparisonLineGenerators
{
    private static readonly string[] SigmaSpellings = ["Sigma", "sigma", "σ"];

    private static readonly string[] Prefixes = ["", "rating.", "member.Rating.", "_current."];

    private static readonly string[] Operators = ["<", ">", "<=", ">="];

    private static readonly string[] RightHandSides =
    [
        "_config.ProvisionalThreshold",
        "threshold",
        "25.0 / 6.0",
        "ProvisionalSigmaThreshold",
    ];

    /// <summary>Arbitrary for a single generated line.</summary>
    /// <returns>The arbitrary.</returns>
    public static Arbitrary<SigmaComparisonLine> SigmaComparisonLine() =>
        Arb.From(Gen.OneOf(Comparisons(), NearMisses()));

    /// <summary>
    /// Lines that are σ-threshold comparisons, generated with σ on each side of the operator so the
    /// detector is not satisfied by handling only the left-hand form.
    /// </summary>
    private static Gen<SigmaComparisonLine> Comparisons() =>
        from spelling in Gen.Elements(SigmaSpellings)
        from prefix in Gen.Elements(Prefixes)
        from op in Gen.Elements(Operators)
        from rhs in Gen.Elements(RightHandSides)
        from sigmaOnLeft in Gen.Elements(true, false)
        select sigmaOnLeft
            ? new SigmaComparisonLine(
                $"        var provisional = {prefix}{spelling} {op} {rhs};",
                IsComparison: true,
                Shape: "comparison (sigma left)")
            : new SigmaComparisonLine(
                $"        var provisional = {rhs} {op} {prefix}{spelling};",
                IsComparison: true,
                Shape: "comparison (sigma right)");

    /// <summary>
    /// Lines that mention σ without classifying by it. These are the constructs that would make the
    /// rule unusable if they fired, so the property pins them as negatives rather than leaving them to
    /// chance.
    /// </summary>
    private static Gen<SigmaComparisonLine> NearMisses() =>
        from spelling in Gen.Elements(SigmaSpellings)
        from prefix in Gen.Elements(Prefixes)
        from shape in Gen.Elements("lambda projection", "plain mention", "generic argument")
        select shape switch
        {
            "lambda projection" => new SigmaComparisonLine(
                $"        var values = ratings.Select(r => r.{spelling}).ToList();",
                IsComparison: false,
                Shape: shape),
            "plain mention" => new SigmaComparisonLine(
                $"        var value = {prefix}{spelling};",
                IsComparison: false,
                Shape: shape),
            _ => new SigmaComparisonLine(
                $"        IReadOnlyList<{spelling}Value> values = Build{spelling}Values();",
                IsComparison: false,
                Shape: shape),
        };
}
