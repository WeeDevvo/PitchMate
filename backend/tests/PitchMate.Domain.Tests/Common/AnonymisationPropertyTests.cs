using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// Property-based tests for in-memory anonymisation (persistence-foundation design Properties 13
/// and 16), exercised through <see cref="AnonymisableTestEntity"/>. Each property runs at least 100
/// iterations over arbitrary initial PII and non-PII values, with both soft-deleted and
/// non-deleted entities, and with relationship members (a reference and a collection) attached so
/// the tests can assert exactly what <see cref="IAnonymisable.Anonymise"/> changes and what it
/// leaves untouched.
/// </summary>
[Trait("Feature", "persistence-foundation")]
public class AnonymisationPropertyTests
{
    /// <summary>A fixed UTC epoch the generated soft-delete instants hang off, keeping them deterministic.</summary>
    private static readonly DateTimeOffset Epoch = new(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>An arbitrary initial state for an <see cref="AnonymisableTestEntity"/> under test.</summary>
    private sealed record EntityValues(
        string DisplayName,
        string? Email,
        string? AvatarUrl,
        Guid SquadId,
        int SkillTier,
        int BibCount,
        bool Deleted,
        DateTimeOffset DeletedAt);

    // Feature: persistence-foundation, Property 13: Anonymisation strips PII while preserving
    // identity and structure - for any anonymisable entity holding identifying content, performing
    // Anonymise() leaves its Id, relationships, and non-PII members unchanged while replacing every
    // PII member with the fixed de-identified placeholder so that none of the original identifying
    // content remains. Validates: Requirements 4.2
    [Property(MaxTest = 100)]
    [Trait("Property", "13")]
    public Property AnonymiseStripsPiiPreservingIdentityAndStructure() =>
        Prop.ForAll(Arb.From(ValuesGen()), values =>
        {
            var squad = new RelatedTestEntity();
            var teammates = new[] { new RelatedTestEntity(), new RelatedTestEntity() };
            var entity = Build(values, squad, teammates);

            // Capture the pre-anonymisation state of everything that must be preserved or stripped.
            var originalId = entity.Id;
            var originalDisplayName = entity.DisplayName;
            var originalEmail = entity.Email;
            var originalAvatarUrl = entity.AvatarUrl;
            var originalSquadId = entity.SquadId;
            var originalSkillTier = entity.SkillTier;
            var originalBibCount = entity.BibCount;
            var originalIsDeleted = entity.IsDeleted;
            var originalDeletedAt = entity.DeletedAt;

            entity.Anonymise();

            // Identity and non-PII members are unchanged.
            var identityPreserved = entity.Id == originalId;
            var nonPiiPreserved =
                entity.SquadId == originalSquadId
                && entity.SkillTier == originalSkillTier
                && entity.BibCount == originalBibCount;

            // Relationships are unchanged: same references and same collection contents.
            var relationshipsPreserved =
                ReferenceEquals(entity.Squad, squad)
                && ReferenceEquals(entity.Teammates, teammates)
                && entity.Teammates.SequenceEqual(teammates);

            // Soft-delete state is untouched by anonymisation.
            var softDeletePreserved =
                entity.IsDeleted == originalIsDeleted
                && entity.DeletedAt == originalDeletedAt;

            // Every PII member now holds its fixed de-identified placeholder.
            var piiReplacedWithPlaceholders =
                entity.DisplayName == AnonymisableTestEntity.DisplayNamePlaceholder
                && entity.Email is null
                && entity.AvatarUrl is null;

            // And none of the original identifying content remains - except in the degenerate case
            // where the original value already equalled the placeholder.
            var displayNameDeidentified =
                entity.DisplayName != originalDisplayName
                || originalDisplayName == AnonymisableTestEntity.DisplayNamePlaceholder;
            var emailDeidentified = entity.Email != originalEmail || originalEmail is null;
            var avatarDeidentified = entity.AvatarUrl != originalAvatarUrl || originalAvatarUrl is null;

            return identityPreserved
                && nonPiiPreserved
                && relationshipsPreserved
                && softDeletePreserved
                && piiReplacedWithPlaceholders
                && displayNameDeidentified
                && emailDeidentified
                && avatarDeidentified;
        });

    // Feature: persistence-foundation, Property 16: Anonymisation idempotence - for any anonymisable
    // entity, applying Anonymise() a second (and third) time completes without error and leaves the
    // PII members holding the same de-identified placeholders, so the state after N>=1 applications
    // equals the state after exactly one application. Validates: Requirements 4.6
    [Property(MaxTest = 100)]
    [Trait("Property", "16")]
    public Property AnonymiseIsIdempotent() =>
        Prop.ForAll(Arb.From(ValuesGen()), values =>
        {
            var entity = Build(values, new RelatedTestEntity(), Array.Empty<RelatedTestEntity>());

            entity.Anonymise();
            var displayAfterFirst = entity.DisplayName;
            var emailAfterFirst = entity.Email;
            var avatarAfterFirst = entity.AvatarUrl;

            // Re-applying must be a safe no-op that leaves the placeholders in place.
            entity.Anonymise();
            entity.Anonymise();

            return entity.DisplayName == displayAfterFirst
                && entity.Email == emailAfterFirst
                && entity.AvatarUrl == avatarAfterFirst
                && entity.DisplayName == AnonymisableTestEntity.DisplayNamePlaceholder
                && entity.Email is null
                && entity.AvatarUrl is null;
        });

    /// <summary>Materialises an <see cref="AnonymisableTestEntity"/> from generated values and relationships.</summary>
    private static AnonymisableTestEntity Build(
        EntityValues values,
        RelatedTestEntity squad,
        IReadOnlyList<RelatedTestEntity> teammates)
    {
        var entity = new AnonymisableTestEntity
        {
            DisplayName = values.DisplayName,
            Email = values.Email,
            AvatarUrl = values.AvatarUrl,
            SquadId = values.SquadId,
            SkillTier = values.SkillTier,
            BibCount = values.BibCount,
            Squad = squad,
            Teammates = teammates,
        };

        // Exercise both soft-delete states so Property 13 proves Anonymise() does not touch them.
        if (values.Deleted)
        {
            entity.MarkDeleted(values.DeletedAt);
        }

        return entity;
    }

    /// <summary>Generates an arbitrary initial entity state across PII, non-PII, and soft-delete members.</summary>
    private static Gen<EntityValues> ValuesGen() =>
        from displayName in DisplayNameGen()
        from email in NullableStringGen()
        from avatarUrl in NullableStringGen()
        from squadId in GuidGen()
        from skillTier in Gen.Choose(0, 10)
        from bibCount in Gen.Choose(0, 1000)
        from deleted in Gen.Elements(true, false)
        from offsetSeconds in Gen.Choose(0, 1_000_000)
        select new EntityValues(
            displayName,
            email,
            avatarUrl,
            squadId,
            skillTier,
            bibCount,
            deleted,
            Epoch.AddSeconds(offsetSeconds));

    /// <summary>
    /// Generates a display name: usually arbitrary identifying content, but sometimes the
    /// placeholder itself so the degenerate "already de-identified" case is exercised.
    /// </summary>
    private static Gen<string> DisplayNameGen() =>
        Gen.OneOf(
            Gen.Constant(AnonymisableTestEntity.DisplayNamePlaceholder),
            NonNullStringGen());

    /// <summary>Generates a nullable string: either <see langword="null"/> or an arbitrary non-null string.</summary>
    private static Gen<string?> NullableStringGen() =>
        Gen.OneOf(
            Gen.Constant<string?>(null),
            NonNullStringGen().Select(s => (string?)s));

    /// <summary>Generates an arbitrary, never-null string (possibly empty) from a representative character set.</summary>
    private static Gen<string> NonNullStringGen() =>
        from chars in Gen.ListOf(Gen.Elements("abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789 @.".ToCharArray()))
        select new string(chars.ToArray());

    /// <summary>Generates an arbitrary GUID (a fresh value per sample) for the non-PII identifier member.</summary>
    private static Gen<Guid> GuidGen() => Gen.Constant(0).Select(_ => Guid.NewGuid());
}
