using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The Seam_Coverage_Guard for <b>Property 3 — Declared problem statuses cover everything the seam can
/// emit</b>.
/// <para>
/// <b>Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.5, 3.6</b>
/// </para>
/// <para>
/// A response convention states the statuses its seam can emit. Nothing in the type system ties that
/// statement to the <c>switch</c> that actually decides the status, so the two are free to drift the
/// moment a new error code is added — and the symptom is silent: the surface answers a status the
/// generated client was never told about. This guard closes that gap by measuring rather than reading.
/// Every error code of every subsystem is driven through the real seam, the status is taken off the
/// <see cref="Microsoft.AspNetCore.Http.IResult"/> that comes back, and that status must be a member of
/// the declared set of the convention sitting beside the seam (Requirement 3.5).
/// </para>
/// <para>
/// Quantification is over a <i>discovered</i> finite set, not a sampled one: the error codes come from
/// <see cref="Enum.GetValues(Type)"/>, so a code added next year enters the quantifier without this file
/// being edited. That is what makes the guard durable, and it is why the non-vacuity floor below pins
/// the seam count and the per-seam code count — a discovery regression has to fail rather than pass over
/// an empty set.
/// </para>
/// <para>
/// The seams that take an existence-concealment flag are driven both ways, each way checked against its
/// own declared set, so the substitution of <c>404</c> for <c>403</c> is measured rather than assumed
/// (Requirements 2.3, 2.5). The seams' fixed results — the uniform <c>401</c> and the code-agnostic
/// concealed <c>404</c> — are driven too, because they are statuses the seam emits with no error code
/// involved and are exactly what Requirement 2.8's residual case answers.
/// </para>
/// <para>
/// This guard speaks about the conventions' declared sets, not about which endpoints compose them.
/// Endpoint composition is the endpoint-metadata guard's subject.
/// </para>
/// </summary>
public sealed class SeamCoverageProperties
{
    /// <summary>Every discovered (seam, variant) pairing, for the exhaustive theory below.</summary>
    public static TheoryData<string, string> AllSeamVariants()
    {
        var data = new TheoryData<string, string>();

        foreach (ErrorSeamVariant variant in ErrorSeams.All)
        {
            data.Add(variant.SeamName, variant.VariantName);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 3: Declared problem statuses cover everything the seam can emit.
    // Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.5, 3.6
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(ErrorSeamVariantGenerators) })]
    public Property Property3_DeclaredProblemStatusesCoverEverythingTheSeamCanEmit(ErrorSeamVariant variant)
    {
        ArgumentNullException.ThrowIfNull(variant);

        IReadOnlyList<string> undeclared = variant.UndeclaredEmissions(variant.DeclaredProblemStatuses);

        return (undeclared.Count == 0)
            .ToProperty()
            .Label(string.Join("; ", undeclared))
            .Collect($"{variant.SeamName} ({variant.VariantName})");
    }

    /// <summary>
    /// The exhaustive companion to the property: every discovered seam variant, named individually so a
    /// failure identifies the seam rather than a shrunk counterexample. The failure message names each
    /// offending error code together with the status the convention does not declare (Requirement 3.6).
    /// </summary>
    /// <param name="seamName">The seam class name.</param>
    /// <param name="variantName">The variant name.</param>
    [Theory]
    [MemberData(nameof(AllSeamVariants))]
    public void EverySeamVariantEmitsOnlyStatusesItsConventionDeclares(string seamName, string variantName)
    {
        ErrorSeamVariant variant = Variant(seamName, variantName);

        IReadOnlyList<string> undeclared = variant.UndeclaredEmissions(variant.DeclaredProblemStatuses);

        Assert.True(undeclared.Count == 0, string.Join(Environment.NewLine, undeclared));
    }

    /// <summary>
    /// The non-vacuity floor. Without it the assertions above would pass just as happily over a seam set
    /// that reflection had quietly stopped finding codes — or seams — for.
    /// <para>
    /// All six seams are present; every variant reports a non-zero error-code count matching what
    /// reflection says about its enum; and every one of those codes actually appears among the measured
    /// emissions, so no code was enumerated and then skipped.
    /// </para>
    /// </summary>
    [Fact]
    public void TheDiscoveredSeamSetCoversAllSixSeamsAndEveryErrorCode()
    {
        Assert.Equal(ErrorSeams.DeclaredSeamCount, ErrorSeams.SeamNames.Count);
        Assert.NotEmpty(ErrorSeams.AllEmissions);

        foreach (ErrorSeamVariant variant in ErrorSeams.All)
        {
            Assert.True(
                variant.ErrorCodeCount > 0,
                $"{variant} enumerated no error codes from {variant.ErrorCodeType.Name}.");

            // Every reflected code name appears as a producer, so the codes were driven and not merely
            // counted; the fixed results add to this, hence the inequality rather than equality.
            foreach (string codeName in Enum.GetNames(variant.ErrorCodeType))
            {
                string producer = $"{variant.ErrorCodeType.Name}.{codeName}";

                Assert.Contains(
                    variant.Emissions,
                    emission => string.Equals(emission.Producer, producer, StringComparison.Ordinal));
            }

            Assert.True(
                variant.Emissions.Count >= variant.ErrorCodeCount,
                $"{variant} measured {variant.Emissions.Count} emissions for "
                    + $"{variant.ErrorCodeCount} error codes.");
        }
    }

    /// <summary>
    /// The discriminating control. The coverage check must fail when a status a seam really emits is
    /// missing from the declared set — otherwise it would be satisfied by any set at all — and its
    /// message must name <b>both</b> the producing error code and the undeclared status, which is the
    /// failure output Requirement 3.6 asks for.
    /// <para>
    /// For each variant it removes, one at a time, each status that variant genuinely emits, and checks
    /// the narrowed set is reported as uncovered by the producers that emit it.
    /// </para>
    /// </summary>
    [Fact]
    public void TheCoverageCheckFailsNamingTheCodeAndTheUndeclaredStatus()
    {
        foreach (ErrorSeamVariant variant in ErrorSeams.All)
        {
            foreach (int emittedStatus in variant.Emissions.Select(emission => emission.Status).Distinct())
            {
                IReadOnlyList<int> narrowed =
                    [.. variant.DeclaredProblemStatuses.Where(status => status != emittedStatus)];

                IReadOnlyList<string> undeclared = variant.UndeclaredEmissions(narrowed);

                Assert.NotEmpty(undeclared);

                // Each producer of the withheld status is named, alongside the status itself.
                foreach (SeamEmission emission in
                    variant.Emissions.Where(emission => emission.Status == emittedStatus))
                {
                    Assert.Contains(
                        undeclared,
                        message => message.Contains(emission.Producer, StringComparison.Ordinal)
                            && message.Contains(
                                emittedStatus.ToString(System.Globalization.CultureInfo.InvariantCulture),
                                StringComparison.Ordinal));
                }
            }
        }
    }

    private static ErrorSeamVariant Variant(string seamName, string variantName) =>
        Assert.Single(
            ErrorSeams.All,
            variant => string.Equals(variant.SeamName, seamName, StringComparison.Ordinal)
                && string.Equals(variant.VariantName, variantName, StringComparison.Ordinal));
}

/// <summary>
/// FsCheck arbitraries for <see cref="ErrorSeamVariant"/>. Variants are drawn uniformly from the
/// discovered set, so the generator's input space is exactly what the seams and their conventions
/// report and grows on its own when a seam or variant is added.
/// </summary>
public static class ErrorSeamVariantGenerators
{
    /// <summary>Arbitrary for a single discovered seam variant.</summary>
    public static Arbitrary<ErrorSeamVariant> ErrorSeamVariant() =>
        Arb.From(Gen.Elements(ErrorSeams.All.ToArray()));
}
