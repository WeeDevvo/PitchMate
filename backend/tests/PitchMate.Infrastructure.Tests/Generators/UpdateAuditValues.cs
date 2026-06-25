namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the update audit-stamping property (design Property 6). It supplies two
/// distinct Clock instants and two distinct actors (one for the first persist, one for the later
/// modification) plus an initial and a guaranteed-different modified display name, so that the
/// second save genuinely modifies a persisted property and the test can assert that
/// <c>UpdatedAt</c>/<c>UpdatedBy</c> move to the second values while <c>CreatedAt</c>/<c>CreatedBy</c>
/// remain the first values.
/// </summary>
/// <param name="FirstNow">The Clock instant at first persistence.</param>
/// <param name="SecondNow">The Clock instant at the later modification; strictly later than <see cref="FirstNow"/>.</param>
/// <param name="FirstActor">The actor at first persistence.</param>
/// <param name="SecondActor">The actor at the later modification; distinct from <see cref="FirstActor"/>.</param>
/// <param name="InitialDisplayName">The display name at first persistence.</param>
/// <param name="ModifiedDisplayName">The display name set before the second save; distinct from <see cref="InitialDisplayName"/>.</param>
/// <param name="InitialSkillTier">A representative non-PII value for the inserted row.</param>
public sealed record UpdateAuditValues(
    DateTimeOffset FirstNow,
    DateTimeOffset SecondNow,
    string FirstActor,
    string SecondActor,
    string InitialDisplayName,
    string ModifiedDisplayName,
    int InitialSkillTier);
