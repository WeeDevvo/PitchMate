using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// A representative concrete <see cref="BaseEntity"/> that implements <see cref="IAnonymisable"/>,
/// used to exercise the in-memory anonymisation properties (persistence-foundation design
/// Properties 13 and 16). It deliberately mixes:
/// <list type="bullet">
///   <item><description>PII members (<see cref="DisplayName"/>, <see cref="Email"/>, <see cref="AvatarUrl"/>)
///   that <see cref="Anonymise"/> must replace with fixed de-identified placeholders;</description></item>
///   <item><description>non-PII members (<see cref="SquadId"/>, <see cref="SkillTier"/>,
///   <see cref="BibCount"/>) that must be left unchanged;</description></item>
///   <item><description>relationship members (the <see cref="Squad"/> reference and the
///   <see cref="Teammates"/> collection) that must be left unchanged.</description></item>
/// </list>
/// <para>
/// <see cref="Anonymise"/> replaces every PII member with a fixed placeholder that retains none of
/// the original identifying content, leaves <c>Id</c>, relationships, non-PII members, and
/// soft-delete state untouched, and is idempotent.
/// </para>
/// </summary>
public sealed class AnonymisableTestEntity : BaseEntity, IAnonymisable
{
    /// <summary>The fixed de-identified placeholder a display name is replaced with on anonymisation.</summary>
    public const string DisplayNamePlaceholder = "Former player";

    /// <summary>PII: the player's display name. Replaced with <see cref="DisplayNamePlaceholder"/> on anonymisation.</summary>
    public string DisplayName { get; set; } = DisplayNamePlaceholder;

    /// <summary>PII: the player's email. Cleared (set to <see langword="null"/>) on anonymisation.</summary>
    public string? Email { get; set; }

    /// <summary>PII: the player's avatar reference. Cleared (set to <see langword="null"/>) on anonymisation.</summary>
    public string? AvatarUrl { get; set; }

    /// <summary>Non-PII: the owning squad's identifier. Unchanged by anonymisation.</summary>
    public Guid SquadId { get; set; }

    /// <summary>Non-PII: the seeded skill tier. Unchanged by anonymisation.</summary>
    public int SkillTier { get; set; }

    /// <summary>Non-PII: a fun counter (e.g. bib appearances). Unchanged by anonymisation.</summary>
    public int BibCount { get; set; }

    /// <summary>Relationship: a navigation reference to another entity. Unchanged by anonymisation.</summary>
    public RelatedTestEntity? Squad { get; set; }

    /// <summary>Relationship: a navigation collection of related entities. Unchanged by anonymisation.</summary>
    public IReadOnlyList<RelatedTestEntity> Teammates { get; set; } = Array.Empty<RelatedTestEntity>();

    /// <summary>Creates an entity with an auto-generated UUID version 7 identity.</summary>
    public AnonymisableTestEntity()
    {
    }

    /// <summary>Creates an entity with the supplied identity (or an auto-generated one when empty).</summary>
    /// <param name="id">The caller-supplied identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    public AnonymisableTestEntity(Guid id) : base(id)
    {
    }

    /// <summary>
    /// Replaces every PII member with its fixed de-identified placeholder, retaining none of the
    /// original identifying content, while leaving <c>Id</c>, relationships, non-PII members, and
    /// soft-delete state unchanged. Idempotent: a second application is a safe no-op.
    /// </summary>
    public void Anonymise()
    {
        DisplayName = DisplayNamePlaceholder;
        Email = null;
        AvatarUrl = null;
    }
}
