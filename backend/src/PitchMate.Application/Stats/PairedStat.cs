namespace PitchMate.Application.Stats;

/// <summary>
/// One entry in a subject membership's "best partnerships" or "bogey opponents" result: another
/// <c>Squad_Membership</c>, the subject's win percentage across the qualifying subset of completed
/// matches shared with them, and the number of matches in that qualifying subset (Requirement 11.1,
/// 11.2). For a partnership the qualifying subset is matches shared on the same kickoff team; for a
/// bogey opponent it is matches on different kickoff teams. The <see cref="DisplayName"/> is the
/// "Former player" placeholder for an anonymised membership.
/// </summary>
/// <param name="MembershipId">The other membership's identity.</param>
/// <param name="DisplayName">The other membership's display name within the squad.</param>
/// <param name="Value">The subject's win percentage over the qualifying subset of matches.</param>
/// <param name="QualifyingMatches">The count of completed matches in the qualifying subset.</param>
public sealed record PairedStat(Guid MembershipId, string DisplayName, double Value, int QualifyingMatches);
