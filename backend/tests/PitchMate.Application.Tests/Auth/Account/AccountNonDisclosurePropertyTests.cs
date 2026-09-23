using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.Auth.UseCases;
using Kind = PitchMate.Application.Tests.Auth.Account.ResolvingIdentifierScan.DisclosureKind;

namespace PitchMate.Application.Tests.Auth.Account;

/// <summary>
/// The Account_Non_Disclosure_Guard for <b>Property 16 — neither account read model exposes a
/// resolving identifier</b>.
/// <para>
/// <b>Validates: Requirements 8.7, 8.8, 9.2, 9.4</b>
/// </para>
/// <para>
/// For any type and any member in the transitive type graph reachable from <see cref="AccountView"/>,
/// and likewise from <see cref="UserDataExport"/>, that member neither names nor carries a provider
/// subject, a password credential, or token material; <see cref="UserDataExport"/> additionally
/// carries no identity id; and the two graphs share no type carrying an identity id — which is what
/// keeps them two read models rather than one, so a field added to the account view for account
/// settings cannot reach the DSAR export (Requirement 9.4).
/// </para>
/// <para>
/// The walk is <see cref="ResolvingIdentifierScan"/>: transitive, cycle-guarded, and driven by member
/// name and member type rather than by a list of known-bad members, so a disclosing member added to
/// either graph later is caught without this file being edited (Requirement 8.8). The property draws
/// members from what the walk reports; the theory beside it is exhaustive over the same set, so a
/// failure names the exact declaration rather than a shrunk counterexample.
/// </para>
/// <para>
/// Non-vacuity comes from two directions. <see cref="PlantedDisclosures"/> supplies test-only read
/// models that each plant one disclosing member — on the root, two hops down behind a collection,
/// carried by a benignly named member's type, on a public nested type, and behind a self-reference
/// that would loop forever without the cycle guard — and the walker must find every one of them. The
/// floors below then pin the member and type counts the walk reports, so a walk that quietly stopped
/// discovering anything fails rather than passing empty.
/// </para>
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class AccountNonDisclosurePropertyTests
{
    /// <summary>The label used for the account-view graph in failure messages and test names.</summary>
    public const string AccountRoot = nameof(AccountView);

    /// <summary>The label used for the DSAR export graph in failure messages and test names.</summary>
    public const string ExportRoot = nameof(UserDataExport);

    // The floors. AccountView declares six members and LinkedIdentityView three; UserDataExport
    // declares four. Stated as minimums so adding a benign member does not break the guard, but a
    // walk that stops finding members does.
    private const int AccountGraphMemberFloor = 9;
    private const int ExportGraphMemberFloor = 4;

    /// <summary>The walked type graph reachable from <see cref="AccountView"/>.</summary>
    public static ResolvingIdentifierScan.Graph AccountGraph { get; } =
        ResolvingIdentifierScan.Walk(typeof(AccountView));

    /// <summary>The walked type graph reachable from <see cref="UserDataExport"/>.</summary>
    public static ResolvingIdentifierScan.Graph ExportGraph { get; } =
        ResolvingIdentifierScan.Walk(typeof(UserDataExport));

    /// <summary>Every member of both graphs, tagged with the root it was reached from.</summary>
    public static IReadOnlyList<AccountGraphMember> AllMembers { get; } =
    [
        .. AccountGraph.Members.Select(member => new AccountGraphMember(AccountRoot, member)),
        .. ExportGraph.Members.Select(member => new AccountGraphMember(ExportRoot, member)),
    ];

    /// <summary>Every walked member, for the exhaustive theory below.</summary>
    /// <returns>Root label, declaring type name, and member name per case.</returns>
    public static TheoryData<string, string, string> EveryWalkedMember()
    {
        var data = new TheoryData<string, string, string>();

        foreach (AccountGraphMember member in AllMembers)
        {
            data.Add(member.RootLabel, member.Member.DeclaringType.Name, member.Member.Name);
        }

        return data;
    }

    /// <summary>Every planted positive-control case, for the exhaustive theory below.</summary>
    /// <returns>The label of each planted case.</returns>
    public static TheoryData<string> EveryPlantedCase()
    {
        var data = new TheoryData<string>();

        foreach (PlantedDisclosures.PlantedCase planted in PlantedDisclosures.Cases)
        {
            data.Add(planted.Label);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 16: Neither account read model exposes a resolving
    // identifier. For any type and any member in the transitive type graph reachable from AccountView,
    // and likewise from UserDataExport, that member neither names nor carries a provider subject, a
    // password credential, or token material — and no member of the UserDataExport graph is an
    // identity id.
    // Validates: Requirements 8.7, 8.8, 9.2, 9.4
    [Property(MaxTest = 300, Arbitrary = new[] { typeof(AccountGraphMemberGenerators) })]
    [Trait("Property", "16")]
    public Property Property16_NeitherAccountReadModelExposesAResolvingIdentifier(AccountGraphMember member)
    {
        ArgumentNullException.ThrowIfNull(member);

        Kind? kind = ResolvingIdentifierScan.Classify(member.Member);

        // Requirements 8.7 and 9.2: nothing in either graph names or carries resolving material. An
        // identity id is a separate classification, permitted on the account view because unlinking
        // needs it.
        bool carriesNoResolvingIdentifier = kind is null or Kind.IdentityId;

        // Requirement 9.2: and the DSAR export does not carry even the identity id.
        bool exportCarriesNoIdentityId = member.RootLabel != ExportRoot || kind is not Kind.IdentityId;

        return (carriesNoResolvingIdentifier && exportCarriesNoIdentityId)
            .ToProperty()
            .Label($"{member.RootLabel} graph: {member.Member} classified as {kind?.ToString() ?? "benign"}")
            .Collect(member.RootLabel);
    }

    // Exhaustive companion to the property: every member the walk reports, named individually so a
    // failure identifies the offending declaration rather than a shrunk counterexample.
    [Theory]
    [MemberData(nameof(EveryWalkedMember))]
    public void NoWalkedMemberCarriesAResolvingIdentifier(
        string rootLabel, string declaringTypeName, string memberName)
    {
        AccountGraphMember member = Locate(rootLabel, declaringTypeName, memberName);

        Kind? kind = ResolvingIdentifierScan.Classify(member.Member);

        Assert.True(
            kind is null or Kind.IdentityId,
            $"{rootLabel} graph discloses a resolving identifier: {member.Member} — {kind}");

        if (rootLabel == ExportRoot)
        {
            Assert.True(
                kind is not Kind.IdentityId,
                $"The DSAR export must carry no identity id, but {member.Member} is one.");
        }
    }

    /// <summary>
    /// The graph-level conjuncts: neither graph carries a resolving identifier anywhere, the export
    /// graph carries no identity id at all, and no type shared by the two graphs carries an identity
    /// id — so the account view's per-identity ids cannot leak into the export through a shared type
    /// (Requirement 9.4).
    /// </summary>
    [Fact]
    public void TheTwoGraphsDiscloseNothingAndShareNoTypeCarryingAnIdentityId()
    {
        Assert.True(
            AccountGraph.Disclosures.Count == 0,
            $"The {AccountRoot} graph discloses resolving identifiers:{Environment.NewLine}"
                + ResolvingIdentifierScan.Report(AccountGraph.Disclosures));

        Assert.True(
            ExportGraph.Disclosures.Count == 0,
            $"The {ExportRoot} graph discloses resolving identifiers:{Environment.NewLine}"
                + ResolvingIdentifierScan.Report(ExportGraph.Disclosures));

        Assert.True(
            ExportGraph.IdentityIds.Count == 0,
            $"The {ExportRoot} graph carries an identity id:{Environment.NewLine}"
                + ResolvingIdentifierScan.Report(ExportGraph.IdentityIds));

        Type[] sharedTypes = [.. AccountGraph.Types.Intersect(ExportGraph.Types)];
        Type[] sharedCarryingAnIdentityId =
            [.. sharedTypes.Where(type => AccountGraph.CarriesIdentityId(type) || ExportGraph.CarriesIdentityId(type))];

        Assert.True(
            sharedCarryingAnIdentityId.Length == 0,
            "The two account read models share a type carrying an identity id: "
                + string.Join(", ", sharedCarryingAnIdentityId.Select(type => type.Name)));

        // Non-vacuity for the conjunct above: the graphs really do overlap (so the intersection is
        // not empty by accident), and the account graph really does contain a type carrying an
        // identity id (so the check has something it could have caught).
        Assert.NotEmpty(sharedTypes);
        Assert.Contains(AccountGraph.Types, type => AccountGraph.CarriesIdentityId(type));
    }

    // Feature: api-response-contracts, Property 16, non-vacuity: the walker detects a deliberately
    // planted disclosing member. For any planted case — on the root, behind a collection, carried by a
    // benignly named member's type, on a public nested type, or behind a self-reference — the walk
    // reports a finding of the expected kind naming the offending type and member.
    // Validates: Requirement 8.8
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AccountGraphMemberGenerators) })]
    [Trait("Property", "16")]
    public Property Property16_TheWalkerDetectsAPlantedDisclosingMember(PlantedDisclosures.PlantedCase planted)
    {
        ArgumentNullException.ThrowIfNull(planted);

        bool detected = Detects(planted);

        return detected
            .ToProperty()
            .Label($"planted {planted.ExpectedKind} at {planted.ExpectedDeclaringTypeName}."
                + $"{planted.ExpectedMemberName} ({planted.Label}) was not reported")
            .Collect(planted.Label);
    }

    // Exhaustive companion: each planted case named individually, so a walker that loses one route
    // (nested types, collection element types, the member-type check, or the cycle guard) fails
    // naming that route rather than a sampled case.
    [Theory]
    [MemberData(nameof(EveryPlantedCase))]
    public void TheWalkerDetectsEveryPlantedDisclosure(string label)
    {
        PlantedDisclosures.PlantedCase planted =
            PlantedDisclosures.Cases.Single(candidate => candidate.Label == label);

        ResolvingIdentifierScan.Graph graph = ResolvingIdentifierScan.Walk(planted.Root);

        Assert.True(
            Detects(planted),
            $"The walk from {planted.Root.Name} did not report {planted.ExpectedKind} at "
                + $"{planted.ExpectedDeclaringTypeName}.{planted.ExpectedMemberName}. It reported:"
                + Environment.NewLine
                + (graph.Findings.Count == 0 ? "  (nothing)" : ResolvingIdentifierScan.Report(graph.Findings)));
    }

    /// <summary>
    /// The other side of the control: a test-only read model shaped like the real ones, carrying
    /// nothing resolving, must yield no finding — so the walker is discriminating rather than
    /// condemning every member it sees.
    /// </summary>
    [Fact]
    public void TheWalkerReportsNothingForABenignReadModel()
    {
        ResolvingIdentifierScan.Graph graph =
            ResolvingIdentifierScan.Walk(typeof(PlantedDisclosures.BenignControl));

        Assert.True(
            graph.Findings.Count == 0,
            "The benign control was reported as disclosing:" + Environment.NewLine
                + ResolvingIdentifierScan.Report(graph.Findings));

        // And it was genuinely walked, rather than skipped.
        Assert.True(graph.Members.Count >= 7, $"Walked only {graph.Members.Count} members of the benign control.");
    }

    /// <summary>
    /// The non-vacuity floor for the two real graphs. Without it the property and the theory could
    /// both pass over a walk that had quietly stopped discovering members or types.
    /// </summary>
    [Fact]
    public void TheWalkReachesBothGraphsInFull()
    {
        Assert.True(
            AccountGraph.Members.Count >= AccountGraphMemberFloor,
            $"Expected at least {AccountGraphMemberFloor} members in the {AccountRoot} graph, walked "
                + $"{AccountGraph.Members.Count}: {string.Join(", ", AccountGraph.Members.Select(m => m.ToString()))}");

        Assert.True(
            ExportGraph.Members.Count >= ExportGraphMemberFloor,
            $"Expected at least {ExportGraphMemberFloor} members in the {ExportRoot} graph, walked "
                + $"{ExportGraph.Members.Count}: {string.Join(", ", ExportGraph.Members.Select(m => m.ToString()))}");

        // The walk is transitive, not shallow: it reached the collection element type behind
        // AccountView.LinkedIdentities and classified the identity id it carries.
        Assert.Contains(typeof(LinkedIdentityView), AccountGraph.Types);
        Assert.Contains(
            AccountGraph.IdentityIds,
            finding => finding.Member.DeclaringType == typeof(LinkedIdentityView)
                && finding.Member.Name == nameof(LinkedIdentityView.IdentityId));

        // And the export graph is a distinct walk that never reaches that type.
        Assert.DoesNotContain(typeof(LinkedIdentityView), ExportGraph.Types);

        Assert.Equal(AllMembers.Count, AccountGraph.Members.Count + ExportGraph.Members.Count);
    }

    /// <summary>Whether the walk from a planted case's root reports the finding it planted.</summary>
    private static bool Detects(PlantedDisclosures.PlantedCase planted)
    {
        ResolvingIdentifierScan.Graph graph = ResolvingIdentifierScan.Walk(planted.Root);

        return graph.Findings.Any(finding =>
            finding.Kind == planted.ExpectedKind
            && finding.Member.DeclaringType.Name == planted.ExpectedDeclaringTypeName
            && finding.Member.Name == planted.ExpectedMemberName);
    }

    /// <summary>Resolves a theory case back to the walked member it names.</summary>
    private static AccountGraphMember Locate(string rootLabel, string declaringTypeName, string memberName) =>
        AllMembers.Single(candidate =>
            candidate.RootLabel == rootLabel
            && candidate.Member.DeclaringType.Name == declaringTypeName
            && candidate.Member.Name == memberName);
}

/// <summary>
/// One member of one walked graph, tagged with the read-model root it was reached from so the
/// export-only conjunct can be applied to the right half of the input space.
/// </summary>
/// <param name="RootLabel">The read-model root this member was reached from.</param>
/// <param name="Member">The walked member.</param>
public sealed record AccountGraphMember(string RootLabel, ResolvingIdentifierScan.ScannedMember Member)
{
    /// <summary>Names the root and the offending declaration.</summary>
    public override string ToString() => $"{RootLabel} graph: {Member}";
}

/// <summary>
/// FsCheck arbitraries for Property 16. Both input spaces are exactly what reflection reports:
/// members are drawn uniformly from every member of both walked graphs, so the space grows on its own
/// when a member is added to either read model, and planted cases are drawn from the positive-control
/// set. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(AccountGraphMemberGenerators) })]</c>.
/// </summary>
public static class AccountGraphMemberGenerators
{
    /// <summary>Arbitrary for a single walked member of either account read model graph.</summary>
    public static Arbitrary<AccountGraphMember> AccountGraphMember() =>
        Arb.From(Gen.Elements(AccountNonDisclosurePropertyTests.AllMembers.ToArray()));

    /// <summary>Arbitrary for a single planted positive-control case.</summary>
    public static Arbitrary<PlantedDisclosures.PlantedCase> PlantedCase() =>
        Arb.From(Gen.Elements(PlantedDisclosures.Cases.ToArray()));
}
