using FsCheck;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the anonymisation-persistence property tests
/// (design Properties 14–15). They reuse <see cref="AuditStampingGenerators"/>'s building blocks so
/// instants are truncated to PostgreSQL <c>timestamptz</c> microsecond precision with a UTC offset
/// (round-tripping exactly for <c>DeletedAt</c>/audit assertions) and text is drawn from a NUL-free
/// alphabet that stores unchanged in a PostgreSQL <c>text</c> column.
/// <para>
/// Both generators guarantee the inserted rows carry identifying content that genuinely differs from
/// the de-identified placeholders (a non-placeholder display name and a non-null email/avatar), so
/// calling <c>Anonymise()</c> always produces a real modification and the subsequent save is a true
/// update — making the audit-metadata and soft-delete-preservation assertions non-trivial. They also
/// derive a strictly-later anonymise instant so the moved <c>UpdatedAt</c> is observable against the
/// fixed <c>CreatedAt</c>.
/// </para>
/// </summary>
public static class AnonymisationGenerators
{
    /// <summary>A safe display name guaranteed not to equal the de-identified placeholder.</summary>
    private static Gen<string> NonPlaceholderName() =>
        from name in AuditStampingGenerators.SafeName()
        select name == PersistenceTestEntity.DisplayNamePlaceholder ? name + "_x" : name;

    /// <summary>Input for design Property 14 (anonymisation records audit metadata).</summary>
    public static Gen<AnonymisationAuditInput> AuditGen() =>
        from firstNow in AuditStampingGenerators.UtcInstant()
        from advanceSeconds in Gen.Choose(0, 1_000_000)
        from advanceMicros in Gen.Choose(1, 999_999)
        from firstActor in AuditStampingGenerators.ActorId()
        from anonymiseActorRaw in AuditStampingGenerators.ActorId()
        from displayName in NonPlaceholderName()
        from email in AuditStampingGenerators.SafeName()
        from avatarUrl in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        from bibCount in Gen.Choose(0, 50)
        select new AnonymisationAuditInput(
            firstNow,
            firstNow.AddSeconds(advanceSeconds).AddTicks(advanceMicros * 10L),
            firstActor,
            anonymiseActorRaw == firstActor ? anonymiseActorRaw + "_2" : anonymiseActorRaw,
            displayName,
            email,
            avatarUrl,
            skillTier,
            bibCount);

    /// <summary>Input for design Property 15 (anonymisation preserves soft-delete state).</summary>
    public static Gen<AnonymisationSoftDeleteInput> SoftDeleteGen() =>
        from createNow in AuditStampingGenerators.UtcInstant()
        from deleteNow in AuditStampingGenerators.UtcInstant()
        from advanceSeconds in Gen.Choose(0, 1_000_000)
        from advanceMicros in Gen.Choose(1, 999_999)
        from actor in AuditStampingGenerators.ActorId()
        from liveDisplayName in NonPlaceholderName()
        from liveEmail in AuditStampingGenerators.SafeName()
        from deletedDisplayName in NonPlaceholderName()
        from deletedEmail in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new AnonymisationSoftDeleteInput(
            createNow,
            deleteNow,
            deleteNow.AddSeconds(advanceSeconds).AddTicks(advanceMicros * 10L),
            actor,
            liveDisplayName,
            liveEmail,
            deletedDisplayName,
            deletedEmail,
            skillTier);
}
