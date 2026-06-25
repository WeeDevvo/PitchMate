namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the Unit-of-Work atomic-rollback property (design Property 19). A run first
/// persists one valid seed row, then performs a single save that bundles three changes: a
/// modification of the seed row, a valid new insert, and a deliberately-invalid insert (a row whose
/// required display name is missing) that forces the save to fail. The property asserts that the
/// failing save surfaces a save-failure error and persists none of its changes — the seed row keeps
/// its original value and the valid insert never appears.
/// </summary>
/// <param name="SeedDisplayName">The valid display name the seed row is first persisted with.</param>
/// <param name="ModifiedDisplayName">A distinct display name the seed row is changed to in the failing save (and which must be rolled back).</param>
/// <param name="GoodDisplayName">The valid display name of the new row that must not be persisted because the save fails atomically.</param>
/// <param name="ClockNow">The UTC instant the Clock reports throughout the run.</param>
/// <param name="Actor">The current actor stamped onto the audit metadata.</param>
public sealed record UnitOfWorkRollbackInput(
    string SeedDisplayName,
    string ModifiedDisplayName,
    string GoodDisplayName,
    DateTimeOffset ClockNow,
    string Actor);
