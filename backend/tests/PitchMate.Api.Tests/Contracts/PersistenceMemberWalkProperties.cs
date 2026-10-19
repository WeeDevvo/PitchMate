using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Common;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// <b>Property 19 — No persistence member crosses the wire on any match response.</b>
/// <para>
/// <b>Validates: Requirements 8.3, 8.6, 8.7, 8.8</b>
/// </para>
/// <para>
/// This is the guard <c>PUT .../availability</c> needed and did not have. It declared the
/// <c>AvailabilityResponse</c> <em>persistence entity</em> as its response contract, so every response
/// published the entity's <see cref="BaseEntity"/>-declared members: the row identity, the creation and
/// update instants, the creating and updating actors, the soft-delete flag and the deletion instant. A
/// client was handed seven members to ignore, two of them naming which <i>user</i> last wrote the row and
/// one of them disclosing a row's soft-delete state. Every existing guard stayed green, because each
/// asked about statuses, problem shapes, route parameters or enum vocabularies, and none walked a
/// contract's type graph. Task 2.1 replaced the contract; keeping it replaced — and keeping the next
/// contract from arriving the same way — is this property's job.
/// </para>
/// <para>
/// The property has two parts, and they answer different questions.
/// </para>
/// <para>
/// The <b>contract sweep</b> quantifies over every response contract the running host declares for a
/// match operation — read off the framework's own response metadata for the endpoints whose route carries
/// a literal <c>matches</c> segment, which is both route groups and no list in the test — and walks each
/// one's reachable type graph. Because the surface is a finite discovered set, exhausting it is strictly
/// stronger than sampling it, which is why this half is a fact rather than a generator.
/// </para>
/// <para>
/// The <b>discriminating half</b> is the part that earns the property (Requirement 8.7). On its own the
/// sweep re-states what task 2.1 already made green, and it would be satisfied just as well by a walk
/// that enumerated no members, followed no collections, or compared against the wrong declaring type. So
/// the same rule is applied to generated mixtures of contracts built to break it and contracts built to
/// survive it, and it must report exactly the former: the entity-as-contract, the entity behind a member,
/// behind a collection, behind an array and behind three levels of nesting — while leaving clean the near
/// miss that declares its own members spelled exactly like <see cref="BaseEntity"/>'s, the
/// self-referencing contract, the mutually-referencing pair, and four shipped match contracts. See
/// <see cref="PlantedPersistenceContracts"/> for why each shape is there.
/// </para>
/// </summary>
public sealed class PersistenceMemberWalkProperties : IClassFixture<MappedEndpointCatalogue>
{
    /// <summary>
    /// The non-vacuity floor on the discovered contract set: the twelve match-lifecycle success contracts
    /// the surface publishes today — the draft result, the replacement availability result, the
    /// availability tally, the confirmation result, the guest-participant result, the team proposal, the
    /// lock result, the team sheet, and the start, record-result, completion and cancellation results.
    /// <para>
    /// A minimum rather than an equality, so it fails when a contract is lost and does not fail when a
    /// later chore adds one — the three live-tracking contracts and the problem body already sit above it,
    /// and the three reads of this chore will push it higher without this line needing to move. It is a
    /// named constant precisely so raising it is a one-line edit (<b>task 16.2</b> moves the guard
    /// constants of this chore).
    /// </para>
    /// </summary>
    private const int MinimumInspectedContractCount = 12;

    /// <summary>
    /// The non-vacuity floor on the walk's <i>depth</i>: at least one type is reached <b>through</b> a
    /// contract rather than being a contract itself.
    /// <para>
    /// This is the conjunct the contract floor cannot express. A walk that enumerated the twelve roots and
    /// followed nothing out of them would clear the count above while inspecting no nested shape at all —
    /// and the shipped defect's modern form is exactly a nested one, an entity hanging off a roster or a
    /// list row. Asserted as a minimum, though five are reached today: the availability tally's per-day
    /// entries, the team sheet's teams, the proposal's per-team assignments, the completion result's team
    /// scores, and the tracked-result response's recorded outcome. The remaining contracts are flat —
    /// identities, instants and scalar collections — which is exactly why the floor is one and not twelve.
    /// </para>
    /// </summary>
    private const int MinimumInspectedNestedTypeCount = 1;

    private readonly IReadOnlyList<Type> _contracts;
    private readonly IReadOnlyList<string> _matchRoutes;

    /// <summary>
    /// Receives the endpoints read off the running host and projects the match surface's declared
    /// response contracts out of them.
    /// </summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    public PersistenceMemberWalkProperties(MappedEndpointCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        _contracts = PersistenceMemberRule.MatchResponseContractsOf(catalogue.Endpoints);
        _matchRoutes =
        [
            .. catalogue.Endpoints
                .Where(static endpoint => RouteParameterRule.IsMatchPath(endpoint.Route))
                .Select(static endpoint => endpoint.Route)
                .Distinct(StringComparer.Ordinal),
        ];
    }

    /// <summary>Every planted shape, named individually for the exhaustive companion.</summary>
    /// <returns>One case per planted shape.</returns>
    public static TheoryData<string> AllPlantedShapes()
    {
        var data = new TheoryData<string>();

        foreach (Type shape in PlantedPersistenceContracts.Planted)
        {
            data.Add(shape.Name);
        }

        return data;
    }

    /// <summary>Every clean shape, named individually for the exhaustive companion.</summary>
    /// <returns>One case per clean shape.</returns>
    public static TheoryData<string> AllCleanShapes()
    {
        var data = new TheoryData<string>();

        foreach (Type shape in PlantedPersistenceContracts.Clean)
        {
            data.Add(shape.Name);
        }

        return data;
    }

    // Feature: match-read-models, Property 19: No persistence member crosses the wire on any match
    // response.
    // Validates: Requirements 8.3, 8.6, 8.8
    /// <summary>
    /// The contract sweep: no member reachable from any declared match response contract is declared by
    /// the persistence base entity. Quantified over the discovered set, so a contract declared next year
    /// enters this assertion without the test being edited.
    /// </summary>
    [Fact]
    [Trait("Property", "19")]
    public void Property19_NoPersistenceMemberIsReachableFromAnyMatchResponseContract()
    {
        IReadOnlyList<string> violations = PersistenceMemberRule.PersistenceMembersOf(_contracts);

        Assert.True(
            violations.Count == 0,
            Report("persistence members reachable from a match response contract", violations));
    }

    // Feature: match-read-models, Property 19: No persistence member crosses the wire on any match
    // response.
    // Validates: Requirements 8.6, 8.7
    /// <summary>
    /// The discriminating half, over generated mixtures: the walk reports every planted contract, naming
    /// it, and reports no clean contract — whatever mixture of the two it is handed, the empty planted set
    /// included.
    /// <para>
    /// The mixture is generated rather than fixed so each conjunct is a statement about the rule and not
    /// about one hand-picked pair. A rule that condemned everything would fail the clean conjunct; a rule
    /// that condemned nothing would fail the planted one; a rule keyed on member names would fail on the
    /// audit-lookalike contract; a rule without a visited set would never return on the self-referencing
    /// one.
    /// </para>
    /// </summary>
    /// <param name="generated">The generated clean/planted mixture.</param>
    /// <returns>The property.</returns>
    [Property(MaxTest = 150, Arbitrary = new[] { typeof(PersistenceMemberWalkCaseGenerators) })]
    [Trait("Property", "19")]
    public Property Property19_TheWalkReportsExactlyThePlantedContractsOutOfAnyMixture(
        PersistenceMemberWalkCase generated)
    {
        ArgumentNullException.ThrowIfNull(generated);

        IReadOnlyList<string> reported = PersistenceMemberRule.PersistenceMembersOf(generated.Walked);
        IReadOnlyList<string> cleanAlone = PersistenceMemberRule.PersistenceMembersOf(generated.Clean);

        bool everyPlantedReportedByName = generated.Planted.All(planted =>
            reported.Any(message => PersistenceMemberRule.IsReportedAgainst(message, planted)));

        bool noCleanReported = !reported.Any(message =>
            generated.Clean.Any(clean => PersistenceMemberRule.IsReportedAgainst(message, clean)));

        // Nothing is attributed to a contract outside the mixture, so the count below is exhaustive
        // rather than merely sufficient.
        bool everyMessageAttributed = reported.All(message =>
            generated.Walked.Any(contract =>
                PersistenceMemberRule.IsReportedAgainst(message, contract)));

        // The walk falls silent exactly when there is nothing to find.
        bool silentWhenNothingPlanted = (reported.Count > 0) == (generated.Planted.Count > 0);

        return (everyPlantedReportedByName
                && noCleanReported
                && everyMessageAttributed
                && silentWhenNothingPlanted
                && cleanAlone.Count == 0)
            .ToProperty()
            .Label(
                $"{generated}: reported [{string.Join(" | ", reported)}]; "
                    + $"clean alone reported [{string.Join(" | ", cleanAlone)}]")
            .Collect(generated.Classification);
    }

    /// <summary>
    /// The exhaustive companion to the discriminating half's planted side: each way a persistence member
    /// can arrive on a contract, named individually so a failure identifies the shape rather than a
    /// shrunk counterexample.
    /// <para>
    /// Each message must name the contract, the member path it was reached by, the member itself and the
    /// declaring type that condemned it — the guard's output is a worklist, and an offender nobody can
    /// locate is not actionable. Every one of
    /// <see cref="PersistenceMemberRule.PersistenceBaseEntityMemberNames"/> must appear, because the
    /// defect is the whole audit block arriving together and a walk that found only the identity would
    /// leave six members on the wire.
    /// </para>
    /// </summary>
    /// <param name="shapeName">The planted shape under test.</param>
    [Theory]
    [MemberData(nameof(AllPlantedShapes))]
    [Trait("Property", "19")]
    public void EachWayAPersistenceMemberArrivesIsReportedNamingTheContractAndTheMember(string shapeName)
    {
        Type shape = PlantedPersistenceContracts.Resolve(shapeName);

        IReadOnlyList<string> reported = PersistenceMemberRule.PersistenceMembersOf(shape);
        IReadOnlyList<string> baseMembers = PersistenceMemberRule.PersistenceBaseEntityMemberNames();

        Assert.NotEmpty(reported);
        Assert.All(reported, message =>
        {
            Assert.True(
                PersistenceMemberRule.IsReportedAgainst(message, shape),
                $"'{message}' does not name {shape.Name} as the offending contract.");

            Assert.Contains(nameof(BaseEntity), message, StringComparison.Ordinal);
            Assert.Contains(typeof(BaseEntity).FullName!, message, StringComparison.Ordinal);
        });

        // The whole audit block is found, not just the identity.
        Assert.All(baseMembers, member =>
            Assert.Contains(
                reported,
                message => message.Contains($".{member}'", StringComparison.Ordinal)));
    }

    /// <summary>
    /// The exhaustive companion to the discriminating half's clean side: each clean shape is reported
    /// clean, and its graph was genuinely walked rather than skipped.
    /// <para>
    /// The second assertion is what separates "clean" from "never looked at". A shape whose graph the walk
    /// declined to enter would be reported clean for the wrong reason, so each one is also required to
    /// have had itself reached — and the two cyclic shapes are required to have <i>terminated</i>, which
    /// is the only observable form "without unbounded recursion" takes (Requirement 8.6): the assertion
    /// returning at all is the proof.
    /// </para>
    /// </summary>
    /// <param name="shapeName">The clean shape under test.</param>
    [Theory]
    [MemberData(nameof(AllCleanShapes))]
    [Trait("Property", "19")]
    public void EachCleanShapeIsReportedCleanAndItsGraphIsWalked(string shapeName)
    {
        Type shape = PlantedPersistenceContracts.Resolve(shapeName);

        Assert.Empty(PersistenceMemberRule.PersistenceMembersOf(shape));

        IReadOnlyList<Type> graph = PersistenceMemberRule.TypeGraphOf(shape);

        Assert.Equal(shape, graph[0]);
        Assert.Equal(graph.Count, graph.Distinct().Count());
    }

    /// <summary>
    /// The detect-by-declaring-type claim, stated directly rather than only as a consequence of the
    /// generated half (Requirement 8.6): the persistence base entity really does declare the seven audit
    /// and soft-delete members the rule looks for, a contract declaring members of its own spelled exactly
    /// like all seven is clean, and the real match surface really does publish contracts carrying their
    /// own <c>MatchId</c> — so "a contract's own matchId does not fail the guard" is a fact about the
    /// shipped surface and not only about a test fixture.
    /// </summary>
    [Fact]
    [Trait("Property", "19")]
    public void TheRuleDetectsByDeclaringTypeAndNotByMemberName()
    {
        IReadOnlyList<string> baseMembers = PersistenceMemberRule.PersistenceBaseEntityMemberNames();

        Assert.Equal(
            [
                nameof(BaseEntity.CreatedAt),
                nameof(BaseEntity.CreatedBy),
                nameof(BaseEntity.DeletedAt),
                nameof(BaseEntity.Id),
                nameof(BaseEntity.IsDeleted),
                nameof(BaseEntity.UpdatedAt),
                nameof(BaseEntity.UpdatedBy),
            ],
            baseMembers);

        // The near miss: the same seven names, declared by the contract itself, are not offences.
        Type lookalike = typeof(PlantedPersistenceContracts.ContractDeclaringItsOwnAuditLookalikes);

        Assert.All(baseMembers, member =>
            Assert.NotNull(lookalike.GetProperty(member)));

        Assert.Empty(PersistenceMemberRule.PersistenceMembersOf(lookalike));

        // And the shipped surface really does carry identity members of its own.
        Assert.Contains(
            _contracts,
            static contract => PersistenceMemberRule.TypeGraphOf(contract)
                .Any(static reached => reached.GetProperty("MatchId") is { } identity
                    && identity.DeclaringType == reached));
    }

    /// <summary>
    /// The non-vacuity floor (Requirement 13.16). Without it the sweep is satisfied by an empty set —
    /// which is exactly what a change to how endpoints or match routes are discovered would produce: the
    /// guard would go green at the moment it stopped looking at anything.
    /// <para>
    /// At least <see cref="MinimumInspectedContractCount"/> contracts were discovered and at least
    /// <see cref="MinimumInspectedNestedTypeCount"/> type was reached through one of them rather than
    /// being one of them; both match route groups contributed; and the contracts are real declared types
    /// rather than placeholders.
    /// </para>
    /// </summary>
    [Fact]
    [Trait("Property", "19")]
    public void TheInspectedContractSurfaceIsNonVacuous()
    {
        Assert.True(
            _contracts.Count >= MinimumInspectedContractCount,
            $"Contract discovery found {_contracts.Count} declared match response contract(s); "
                + $"at least {MinimumInspectedContractCount} are declared. "
                + "A rule quantified over nothing holds for everything.");

        IReadOnlyList<Type> nested =
        [
            .. _contracts
                .SelectMany(PersistenceMemberRule.TypeGraphOf)
                .Where(reached => !_contracts.Contains(reached))
                .Distinct(),
        ];

        Assert.True(
            nested.Count >= MinimumInspectedNestedTypeCount,
            $"The walk reached {nested.Count} nested type(s) through the discovered contracts; "
                + $"at least {MinimumInspectedNestedTypeCount} is reachable. "
                + "A walk that followed no member would report no offender.");

        Assert.All(_contracts, contract =>
        {
            Assert.False(contract.IsInterface);
            Assert.NotEqual(typeof(void), contract);
        });

        // Both route groups of the match surface reached the projection, so neither prefix is silently
        // absent from the sweep.
        Assert.Contains(
            _matchRoutes,
            static route => route.StartsWith("/matches/", StringComparison.Ordinal));
        Assert.Contains(
            _matchRoutes,
            static route => route.StartsWith("/squads/", StringComparison.Ordinal));
    }

    /// <summary>
    /// Renders every offender in one message. The guard's output is a worklist, so it names all of them
    /// rather than shrinking to the first.
    /// </summary>
    private static string Report(string subject, IReadOnlyList<string> failures) =>
        $"{failures.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, failures.Select(static failure => $"  - {failure}"));
}
