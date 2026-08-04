namespace PitchMate.Application.Stats;

/// <summary>
/// One entry in a subject membership's "most played with" or "most played against" result: another
/// <c>Squad_Membership</c> the subject has shared the pitch with, together with the count of completed
/// matches they co-appeared in on the same team (played with) or on different teams (played against)
/// (Requirement 10.1, 10.2). The <see cref="DisplayName"/> is the "Former player" placeholder for an
/// anonymised membership.
/// </summary>
/// <param name="MembershipId">The other membership's identity.</param>
/// <param name="DisplayName">The other membership's display name within the squad.</param>
/// <param name="Count">The number of qualifying co-appearances with the subject.</param>
public sealed record CoAppearance(Guid MembershipId, string DisplayName, int Count);
