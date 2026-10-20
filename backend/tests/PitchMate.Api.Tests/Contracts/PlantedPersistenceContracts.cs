using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Contracts that were never declared by any endpoint: test-only shapes that <b>break</b> the
/// persistence-member rule, and test-only and shipped shapes that must <b>not</b> break it — so the walk
/// can be shown to reject something, and to reject only the right thing (Requirement 8.7).
/// <para>
/// Without these the exhaustive sweep over the real match contracts re-states what task 2.1 already made
/// green, and a walk that followed no members, or enumerated no types, or looked for the wrong declaring
/// type would satisfy it perfectly. Each planted shape is a way the shipped defect could come back, and
/// each clean shape is a way a correct contract could be wrongly condemned.
/// </para>
/// <para>
/// <b>The planted entity is a real entity.</b> <see cref="PersistedRow"/> derives from the production
/// <see cref="BaseEntity"/>, so the members the walk must find are the ones the base actually declares
/// rather than members this file wrote to be found. That is what keeps the control about the rule instead
/// of about the fixture: if <see cref="BaseEntity"/> gained an audit column tomorrow, these shapes would
/// carry it without being edited.
/// </para>
/// <para>
/// <b>The clean shapes are the near misses.</b> <see cref="ContractDeclaringItsOwnAuditLookalikes"/>
/// declares members spelled exactly like every one of <see cref="BaseEntity"/>'s — <c>Id</c>,
/// <c>CreatedAt</c>, <c>UpdatedBy</c>, <c>IsDeleted</c> and the rest — but declares them <i>itself</i>, so
/// a rule that matched on member names would condemn it. The self- and mutually-referencing shapes are
/// the termination controls: a walk without a visited set does not fail on them, it never returns.
/// </para>
/// </summary>
internal static class PlantedPersistenceContracts
{
    /// <summary>
    /// A persisted row, as every PitchMate entity is: it inherits the identity, the audit instants, the
    /// audit actors and the soft-delete members from <see cref="BaseEntity"/>, and those inherited members
    /// are what the walk has to find.
    /// </summary>
    internal sealed class PersistedRow : BaseEntity
    {
        /// <summary>A member of the row's own, so the row is not nothing but its inherited members.</summary>
        public Guid SquadMembershipId { get; init; }
    }

    /// <summary>
    /// <b>The shipped defect itself:</b> the declared response contract <i>is</i> a persistence entity.
    /// This is the shape <c>PUT .../availability</c> had before task 2.1 — <c>AvailabilityResponse</c>
    /// declared directly as the response type — and it is the reason Requirement 8.8's "derives from no
    /// persistence base entity" needs no separate check: an entity-as-contract exposes the base's members
    /// and is caught by the member walk.
    /// </summary>
    internal sealed class ContractThatIsItselfAnEntity : BaseEntity
    {
        /// <summary>The value such a contract would legitimately report.</summary>
        public DateTimeOffset SubmittedAt { get; init; }
    }

    /// <summary>A clean contract that carries an entity as a member — the defect one level down.</summary>
    /// <param name="MatchId">The contract's own identity member, which must not be reported.</param>
    /// <param name="Response">The planted entity member.</param>
    internal sealed record ContractCarryingAnEntityMember(Guid MatchId, PersistedRow Response);

    /// <summary>
    /// A clean contract carrying a <i>collection</i> of entities, which is how the defect would arrive on
    /// a list read: the offending members sit behind an <c>IReadOnlyList&lt;T&gt;</c> that a walk not
    /// unwrapping element types would stop at.
    /// </summary>
    /// <param name="MatchId">The contract's own identity member, which must not be reported.</param>
    /// <param name="Responses">The planted entity collection.</param>
    internal sealed record ContractCarryingAnEntityCollection(
        Guid MatchId,
        IReadOnlyList<PersistedRow> Responses);

    /// <summary>The same defect behind an array rather than a generic collection.</summary>
    /// <param name="MatchId">The contract's own identity member, which must not be reported.</param>
    /// <param name="Responses">The planted entity array.</param>
    internal sealed record ContractCarryingAnEntityArray(Guid MatchId, PersistedRow[] Responses);

    /// <summary>
    /// The defect three levels down, behind a nested type and a collection — the depth at which a walk
    /// that followed only immediate members would report nothing.
    /// </summary>
    /// <param name="MatchId">The contract's own identity member, which must not be reported.</param>
    /// <param name="Teams">The nested wrapper that eventually carries the entity.</param>
    internal sealed record ContractCarryingADeeplyNestedEntity(
        Guid MatchId,
        NestedWrapper Teams);

    /// <summary>An intermediate nested type carrying a collection of the next level down.</summary>
    /// <param name="Rosters">The deeper wrappers.</param>
    internal sealed record NestedWrapper(IReadOnlyList<DeeperWrapper> Rosters);

    /// <summary>The deepest nested type, which is where the planted entity actually sits.</summary>
    /// <param name="Response">The planted entity member.</param>
    internal sealed record DeeperWrapper(PersistedRow Response);

    /// <summary>
    /// <b>The detect-by-declaring-type control.</b> Every member here is spelled exactly like a member
    /// <see cref="BaseEntity"/> declares, and every one of them is declared by this record instead. A
    /// name-based rule reports seven offences; the declaring-type rule reports none (Requirement 8.6).
    /// </summary>
    /// <param name="Id">An identity member of the contract's own.</param>
    /// <param name="MatchId">The match identity a real contract legitimately reports.</param>
    /// <param name="CreatedAt">An instant of the contract's own, spelled like the base's.</param>
    /// <param name="UpdatedAt">An instant of the contract's own, spelled like the base's.</param>
    /// <param name="CreatedBy">An actor of the contract's own, spelled like the base's.</param>
    /// <param name="UpdatedBy">An actor of the contract's own, spelled like the base's.</param>
    /// <param name="IsDeleted">A flag of the contract's own, spelled like the base's.</param>
    /// <param name="DeletedAt">An instant of the contract's own, spelled like the base's.</param>
    internal sealed record ContractDeclaringItsOwnAuditLookalikes(
        Guid Id,
        Guid MatchId,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt,
        string? CreatedBy,
        string? UpdatedBy,
        bool IsDeleted,
        DateTimeOffset? DeletedAt);

    /// <summary>
    /// A clean contract that references itself, directly and through a collection — the termination
    /// control for Requirement 8.6's "self-references without unbounded recursion".
    /// </summary>
    /// <param name="MatchId">The contract's own identity member.</param>
    /// <param name="Parent">A direct self-reference.</param>
    /// <param name="Children">A self-reference behind a collection.</param>
    internal sealed record SelfReferencingContract(
        Guid MatchId,
        SelfReferencingContract? Parent,
        IReadOnlyList<SelfReferencingContract> Children);

    /// <summary>
    /// A clean contract in a reference <i>cycle</i> with another type rather than with itself, which a
    /// visited set keyed on the immediate type alone would not break.
    /// </summary>
    /// <param name="MatchId">The contract's own identity member.</param>
    /// <param name="Partner">The other half of the cycle.</param>
    internal sealed record MutuallyReferencingContract(Guid MatchId, MutualPartner Partner);

    /// <summary>The other half of the mutual reference cycle, pointing back.</summary>
    /// <param name="Back">The collection closing the cycle.</param>
    internal sealed record MutualPartner(IReadOnlyList<MutuallyReferencingContract> Back);

    /// <summary>
    /// Every shape the walk must <b>report</b>: the entity-as-contract, and the entity reached through a
    /// member, a collection, an array and three levels of nesting.
    /// </summary>
    public static IReadOnlyList<Type> Planted =>
    [
        typeof(ContractThatIsItselfAnEntity),
        typeof(ContractCarryingAnEntityMember),
        typeof(ContractCarryingAnEntityCollection),
        typeof(ContractCarryingAnEntityArray),
        typeof(ContractCarryingADeeplyNestedEntity),
    ];

    /// <summary>
    /// Every shape the walk must leave <b>clean</b>: the audit-lookalike near miss, the two termination
    /// controls, and four shipped match contracts drawn by compile-time reference — the replacement
    /// availability contract of task 2.1, the two Domain-declared read contracts, and the richest
    /// lifecycle result. Including real shipped contracts in the generated population means the
    /// discriminating half is not reasoning only about shapes this file invented.
    /// </summary>
    public static IReadOnlyList<Type> Clean =>
    [
        typeof(ContractDeclaringItsOwnAuditLookalikes),
        typeof(SelfReferencingContract),
        typeof(MutuallyReferencingContract),
        typeof(SubmitAvailabilityResult),
        typeof(AvailabilityTally),
        typeof(TeamSheet),
        typeof(CompleteMatchResult),
    ];

    /// <summary>
    /// Resolves a shape by its simple type name, so the exhaustive theories can be keyed on a readable
    /// name rather than on a serialised type.
    /// </summary>
    /// <param name="name">The shape's simple type name.</param>
    /// <returns>The shape.</returns>
    public static Type Resolve(string name) =>
        Planted.Concat(Clean).SingleOrDefault(
            shape => string.Equals(shape.Name, name, StringComparison.Ordinal))
            ?? throw new ArgumentOutOfRangeException(
                nameof(name), name, "No planted or clean contract shape carries that name.");
}
