using PitchMate.Domain.Common;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// A representative <see cref="BaseEntity"/>-derived entity used to exercise the shared
/// persistence machinery against real PostgreSQL. It deliberately mixes:
/// <list type="bullet">
///   <item><description>PII members (<see cref="DisplayName"/>, <see cref="Email"/>,
///   <see cref="AvatarUrl"/>) that <see cref="Anonymise"/> must replace with fixed
///   de-identified placeholders;</description></item>
///   <item><description>non-PII members (<see cref="SkillTier"/>, <see cref="BibCount"/>)
///   that anonymisation must leave unchanged;</description></item>
///   <item><description>a navigation relationship (<see cref="Related"/> with its
///   <see cref="RelatedId"/> foreign key) that anonymisation must leave intact and that the
///   schema must map.</description></item>
/// </list>
/// <para>
/// It implements <see cref="IAnonymisable"/> so anonymisation-persistence properties can run
/// against it. The persistence-foundation defines no concrete domain entities of its own —
/// this type exists solely for the tests.
/// </para>
/// </summary>
public sealed class PersistenceTestEntity : BaseEntity, IAnonymisable
{
    /// <summary>The fixed de-identified placeholder a display name is replaced with on anonymisation.</summary>
    public const string DisplayNamePlaceholder = "Former player";

    /// <summary>PII: the player's display name. Replaced with <see cref="DisplayNamePlaceholder"/> on anonymisation.</summary>
    public string DisplayName { get; set; } = DisplayNamePlaceholder;

    /// <summary>PII: the player's email. Cleared (set to <see langword="null"/>) on anonymisation.</summary>
    public string? Email { get; set; }

    /// <summary>PII: the player's avatar reference. Cleared (set to <see langword="null"/>) on anonymisation.</summary>
    public string? AvatarUrl { get; set; }

    /// <summary>Non-PII: the seeded skill tier. Unchanged by anonymisation.</summary>
    public int SkillTier { get; set; }

    /// <summary>Non-PII: a fun counter (e.g. bib appearances). Unchanged by anonymisation.</summary>
    public int BibCount { get; set; }

    /// <summary>Foreign key for the <see cref="Related"/> navigation. Unchanged by anonymisation.</summary>
    public Guid? RelatedId { get; set; }

    /// <summary>Relationship: a navigation reference to a related entity. Unchanged by anonymisation.</summary>
    public PersistenceTestRelatedEntity? Related { get; set; }

    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public PersistenceTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public PersistenceTestEntity(Guid id) : base(id)
    {
    }

    /// <summary>
    /// Replaces every PII member with its fixed de-identified placeholder, retaining none of the
    /// original identifying content, while leaving <c>Id</c>, the <see cref="Related"/> relationship
    /// (and its <see cref="RelatedId"/>), the non-PII members, and soft-delete state unchanged.
    /// Idempotent: a second application is a safe no-op.
    /// </summary>
    public void Anonymise()
    {
        DisplayName = DisplayNamePlaceholder;
        Email = null;
        AvatarUrl = null;
    }
}
