namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the squad GUID v7 + audit-fields persistence property (design Property 41).
/// It carries the clock instant and actor the save pipeline must stamp from, plus valid field
/// values so the persisted squad, owner membership, guest membership, and invite are representative.
/// Display-name distinctness and token-hash uniqueness (the squad unique indexes) are ensured by the
/// test body; the values here need only be individually valid.
/// </summary>
/// <param name="ClockNow">The UTC instant the clock reports at save time; all timestamps must equal this.</param>
/// <param name="Actor">The current actor; all actor identifiers must equal this after persistence.</param>
/// <param name="SquadName">A valid (1..80 char) squad name.</param>
/// <param name="OwnerName">A valid base display name for the owner membership (prefixed in the test).</param>
/// <param name="GuestName">A valid base display name for the guest membership (prefixed in the test).</param>
/// <param name="OwnerUserId">The non-empty backing user identity for the owner membership.</param>
public sealed record PersistedSquadAuditInput(
    DateTimeOffset ClockNow,
    string Actor,
    string SquadName,
    string OwnerName,
    string GuestName,
    Guid OwnerUserId);
