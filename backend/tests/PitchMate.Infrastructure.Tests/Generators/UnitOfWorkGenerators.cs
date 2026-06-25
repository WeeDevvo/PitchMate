using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the Unit-of-Work property tests (design
/// Properties 18 and 19). Instants reuse <see cref="AuditStampingGenerators.UtcInstant"/> (microsecond
/// precision, UTC offset) and text reuses the NUL-free <see cref="AuditStampingGenerators.SafeName"/>
/// generator so values store unchanged in real PostgreSQL columns.
/// <list type="bullet">
///   <item><description>The change-count generator keeps the modify and delete selections within the
///   seeded set (<c>ModifyCount + DeleteCount &lt;= SeedCount</c>) so the expected save count is
///   exactly <c>InsertCount + ModifyCount + DeleteCount</c>, and spans the boundary case of zero total
///   changes.</description></item>
///   <item><description>The rollback generator forces the modified display name to differ from the
///   seed's, so the "affected row left unchanged" assertion after a rolled-back save is
///   non-trivial.</description></item>
/// </list>
/// </summary>
public static class UnitOfWorkGenerators
{
    /// <summary>Input for design Property 18 (a successful save returns the count of state-changed entities).</summary>
    public static Gen<UnitOfWorkChangeCountInput> ChangeCountGen() =>
        from seedCount in Gen.Choose(0, 6)
        from insertCount in Gen.Choose(0, 6)
        from modifyCount in Gen.Choose(0, seedCount)
        from deleteCount in Gen.Choose(0, seedCount - modifyCount)
        from clockNow in AuditStampingGenerators.UtcInstant()
        from actor in AuditStampingGenerators.ActorId()
        select new UnitOfWorkChangeCountInput(
            seedCount,
            insertCount,
            modifyCount,
            deleteCount,
            clockNow,
            actor);

    /// <summary>Input for design Property 19 (a failing save rolls back atomically and surfaces an error).</summary>
    public static Gen<UnitOfWorkRollbackInput> RollbackGen() =>
        from seedName in AuditStampingGenerators.SafeName()
        from modifiedNameRaw in AuditStampingGenerators.SafeName()
        from goodName in AuditStampingGenerators.SafeName()
        from clockNow in AuditStampingGenerators.UtcInstant()
        from actor in AuditStampingGenerators.ActorId()
        select new UnitOfWorkRollbackInput(
            seedName,
            // Guarantee the modification is a genuine change so "left unchanged" is meaningful.
            modifiedNameRaw == seedName ? seedName + "_changed" : modifiedNameRaw,
            goodName,
            clockNow,
            actor);
}
