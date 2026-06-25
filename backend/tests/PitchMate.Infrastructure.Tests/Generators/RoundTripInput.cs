namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the persistence round-trip property (design Property 20). It carries a
/// client-assigned non-zero <c>Entity_Id</c> the save must store unchanged, the Clock instant both
/// audit timestamps are stamped from (so the read-back UTC values can be asserted exactly), and a
/// few representative field values for the stored row.
/// </summary>
/// <param name="Id">A client-assigned non-zero identity that must be stored unchanged (no DB-side key generation).</param>
/// <param name="ClockNow">The UTC instant the Clock reports at save time; the read-back timestamps must equal this.</param>
/// <param name="DisplayName">A representative required PII value for the stored row.</param>
/// <param name="Email">A representative optional PII value for the stored row.</param>
/// <param name="SkillTier">A representative non-PII value for the stored row.</param>
public sealed record RoundTripInput(
    Guid Id,
    DateTimeOffset ClockNow,
    string DisplayName,
    string? Email,
    int SkillTier);
