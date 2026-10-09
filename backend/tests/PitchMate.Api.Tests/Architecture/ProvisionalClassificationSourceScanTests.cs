namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Source-level guard for Requirement 11.6: the provisional/established classification is the Domain
/// rule, so neither the Api nor the squad-standing source may compare a σ against a threshold of its
/// own. Reflection cannot see an inline comparison, so this suite scans the production C# source of
/// <c>PitchMate.Api</c> and <c>PitchMate.Infrastructure</c> in the same idiom as
/// <c>PitchMate.Infrastructure.Tests.Persistence.MigrationPolicySmokeTests</c> — comments stripped so
/// documentary mentions are not mistaken for code, <c>bin</c>/<c>obj</c> excluded, offenders reported
/// by file and line. No extra test package.
///
/// <para>
/// The scan itself — the patterns, the allow-list, the comment stripping, and the file walk — lives in
/// <see cref="InwardLogicSourceScan"/>, because Property 21
/// (<see cref="ApiInwardLogicProperties"/>) applies the same scan to the same discovered file set and
/// additionally generates the comparison variants and near misses the patterns must and must not
/// match. One scanner, two callers, no chance of the guard and the property drifting apart.
/// </para>
///
/// <para>
/// <b>The one declared exception, and why it exists.</b> The rule the scan protects is declared in
/// <c>PitchMate.Domain</c> — the threshold is <c>RatingEngineConfig.ProvisionalThreshold</c> and the
/// contract is <c>IRatingEngine.GetState</c>, both Domain types — but per the project structure the
/// rating engine that <em>implements</em> that Domain contract ships in
/// <c>PitchMate.Infrastructure</c> (<c>PlackettLuceRatingEngine</c>). That single file is therefore
/// the one legitimate home of the comparison, and it is named in an explicit allow-list.
/// <see cref="SourceScan_FindsTheComparisonWhereTheDomainDeclaredRuleIsImplemented"/> is the positive
/// control: it asserts the scan really does find the comparison there, so the negative assertions
/// cannot pass because the patterns match nothing anywhere.
/// </para>
///
/// <para>Validates: Requirements 11.5, 11.6, 11.7, 11.8.</para>
/// </summary>
public class ProvisionalClassificationSourceScanTests
{
    private const string DomainName = "PitchMate.Domain";

    [Fact]
    public void ProvisionalClassification_IsDeclaredInDomain()
    {
        // Requirement 11.6 — the rule the scan protects is a Domain declaration: the σ threshold is a
        // Domain configuration property and the classification contract and its result are Domain types.
        var threshold = typeof(PitchMate.Domain.Rating.RatingEngineConfig)
            .GetProperty(nameof(PitchMate.Domain.Rating.RatingEngineConfig.ProvisionalThreshold));

        Assert.NotNull(threshold);
        Assert.Equal(DomainName, typeof(PitchMate.Domain.Rating.RatingEngineConfig).Assembly.GetName().Name);

        var getState = typeof(PitchMate.Domain.Rating.IRatingEngine)
            .GetMethod(nameof(PitchMate.Domain.Rating.IRatingEngine.GetState));

        Assert.NotNull(getState);
        Assert.Equal(DomainName, typeof(PitchMate.Domain.Rating.IRatingEngine).Assembly.GetName().Name);
        Assert.Equal(DomainName, typeof(PitchMate.Domain.Rating.RatingState).Assembly.GetName().Name);
    }

    [Fact]
    public void SourceScan_FindsTheComparisonWhereTheDomainDeclaredRuleIsImplemented()
    {
        // Positive control (Requirement 11.7 — the suites must not pass vacuously). The scan's patterns
        // do match the real comparison in the one file implementing the Domain-declared classification
        // contract, so a failure of the negative assertions below means a genuine second comparison,
        // not a pattern that matches nothing.
        var matchedFiles = new List<string>();

        foreach (var allowed in InwardLogicSourceScan.SigmaComparisonAllowList)
        {
            var file = InwardLogicSourceScan.ReadAllowListedFile(allowed);

            if (InwardLogicSourceScan.HasDomainDeclaredClassification(file))
            {
                matchedFiles.Add(allowed);
            }
        }

        Assert.True(
            matchedFiles.Count == InwardLogicSourceScan.SigmaComparisonAllowList.Count,
            "The scan must find the sigma-threshold comparison in every allow-listed implementation of " +
            "the Domain-declared classification contract, otherwise the negative assertions pass " +
            $"vacuously (Requirement 11.7). Found in: {Describe(matchedFiles)}.");
    }

    [Fact]
    public void NoSigmaThresholdComparison_AppearsInApiOrInfrastructureOutsideTheRatingEngine()
    {
        // Requirement 11.6 — neither the Api nor the squad-standing source (nor anything else in those
        // two projects) classifies a rating by comparing its σ against a threshold. The classification
        // is obtained from the Domain contract, IRatingEngine.GetState.
        var offenders = ScanProductionSource(InwardLogicSourceScan.HasSigmaComparison);

        Assert.True(
            offenders.Count == 0,
            "No sigma-threshold comparison may appear in PitchMate.Api or PitchMate.Infrastructure " +
            "outside the rating engine implementing the Domain-declared rule (Requirement 11.6). " +
            "Offenders:" + Environment.NewLine + Describe(offenders));
    }

    [Fact]
    public void ProvisionalThreshold_IsNeverReadInApiOrInfrastructureOutsideTheRatingEngine()
    {
        // Requirement 11.6 — the complementary rule: the Domain-declared threshold is not even read
        // outside the engine, so no second classification can be assembled from it.
        var offenders = ScanProductionSource(InwardLogicSourceScan.ReadsProvisionalThreshold);

        Assert.True(
            offenders.Count == 0,
            "The Domain-declared provisional threshold must not be read in PitchMate.Api or " +
            "PitchMate.Infrastructure outside the rating engine (Requirement 11.6). Offenders:" +
            Environment.NewLine + Describe(offenders));
    }

    /// <summary>
    /// Scans every production C# source line of the scanned projects, skipping the allow-listed files,
    /// and collects every line <paramref name="isOffending"/> reports. Asserts the scan really saw
    /// source, so a relocated layout fails rather than passing on an empty file set.
    /// </summary>
    private static List<string> ScanProductionSource(Func<string, bool> isOffending)
    {
        var files = InwardLogicSourceScan.DiscoverProductionSource();
        var offenders = new List<string>();
        var scannedFiles = 0;

        foreach (var file in files)
        {
            if (file.IsSigmaComparisonAllowListed)
            {
                continue;
            }

            scannedFiles++;

            for (var index = 0; index < file.Lines.Count; index++)
            {
                if (isOffending(file.Lines[index]))
                {
                    offenders.Add($"{file.RelativePath}:{index + 1} - {file.Lines[index].Trim()}");
                }
            }
        }

        Assert.True(
            scannedFiles > 0,
            "The source scan saw no files — the scan must cover the source it claims to cover " +
            "(Requirement 11.7).");

        return offenders;
    }

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join(Environment.NewLine, offenders);
}
