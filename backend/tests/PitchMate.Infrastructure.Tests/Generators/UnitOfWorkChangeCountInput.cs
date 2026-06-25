namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the Unit-of-Work change-count property (design Property 18). It describes a
/// mix of tracked state changes whose total is known in advance, so the property can assert that a
/// successful save returns exactly that count and that an immediately-following save with no tracked
/// changes returns zero.
/// <para>
/// A run first persists <see cref="SeedCount"/> entities (so there are existing rows to modify and
/// delete), then performs a single <em>measured</em> save consisting of <see cref="InsertCount"/>
/// new inserts, <see cref="ModifyCount"/> modifications of seeded rows, and <see cref="DeleteCount"/>
/// soft-deletes of other seeded rows. The modify and delete selections are disjoint ranges over the
/// seeded set (so <c>ModifyCount + DeleteCount &lt;= SeedCount</c>), making the expected count
/// <c>InsertCount + ModifyCount + DeleteCount</c>.
/// </para>
/// </summary>
/// <param name="SeedCount">The number of entities persisted before the measured save.</param>
/// <param name="InsertCount">The number of new entities inserted in the measured save.</param>
/// <param name="ModifyCount">The number of seeded entities modified in the measured save.</param>
/// <param name="DeleteCount">The number of (other) seeded entities soft-deleted in the measured save.</param>
/// <param name="ClockNow">The UTC instant the Clock reports throughout the run.</param>
/// <param name="Actor">The current actor stamped onto the audit metadata.</param>
public sealed record UnitOfWorkChangeCountInput(
    int SeedCount,
    int InsertCount,
    int ModifyCount,
    int DeleteCount,
    DateTimeOffset ClockNow,
    string Actor);
