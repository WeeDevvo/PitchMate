namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The per-match, per-membership rich figures derived from a single match's effective events
/// (Requirement 10): the membership's non-own-goal <see cref="Goals"/> (Requirement 10.2), the goals
/// <see cref="ConcededAsKeeper"/> while keeping (Requirement 10.3), the <see cref="KeeperMinutes"/>
/// kept (Requirement 10.5), and <see cref="KeptAnyStint"/> — whether the membership kept at least one
/// stint, the basis for a clean sheet (Requirement 10.4).
/// <para>
/// These per-match figures are the unit summed across a squad's completed matches to produce the
/// <c>IRichStatsSource</c> seam's aggregate. The value object is a pure derivation product carrying no
/// behaviour beyond its data.
/// </para>
/// </summary>
/// <param name="Goals">The membership's count of effective, non-own-goal goals credited as scorer.</param>
/// <param name="ConcededAsKeeper">The count of effective opposing goals conceded while the membership was keeping.</param>
/// <param name="KeeperMinutes">The total whole minutes the membership spent keeping across its stints.</param>
/// <param name="KeptAnyStint">Whether the membership kept one or more stints — the basis for a clean sheet.</param>
public readonly record struct MatchRichStatistics(
    int Goals,
    int ConcededAsKeeper,
    int KeeperMinutes,
    bool KeptAnyStint);
