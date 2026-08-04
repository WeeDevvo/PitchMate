using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Stats;

/// <summary>
/// A squad-scoped read view of a single <c>Squad_Membership</c>'s statistics (Requirement 3.1). It
/// carries the membership's identity, display name, lifecycle state, and guest flag alongside its
/// always-available statistics — record and win percentage, rating summary and progression, streaks,
/// co-appearance and partnership/bogey lists, and bib appearances. <see cref="Rich"/> is present only
/// when the squad has <c>LiveMatchTracking</c> enabled and is <see langword="null"/> (omitted, with
/// no placeholder) otherwise (Requirement 3.2, 13.1, 13.2, 13.7). A subject with no appearance yields
/// zero/empty values and a not-yet-established rating (Requirement 3.4). An anonymised membership
/// uses the "Former player" placeholder display name (Requirement 3.5).
/// </summary>
/// <param name="MembershipId">The subject membership's identity.</param>
/// <param name="DisplayName">The subject membership's display name within the squad.</param>
/// <param name="State">The subject membership's lifecycle state.</param>
/// <param name="IsGuest">Whether the subject is a guest membership (no backing user).</param>
/// <param name="Record">The win/draw/loss record across appearances.</param>
/// <param name="WinPercentage">The win percentage, or <see langword="null"/> when there is no appearance.</param>
/// <param name="Rating">The current rating summary (not-yet-established, provisional, or established).</param>
/// <param name="Progression">The chronological rating progression points; empty when no snapshot exists.</param>
/// <param name="WinStreak">The longest run of consecutive wins.</param>
/// <param name="UnbeatenStreak">The longest run of consecutive non-loss results.</param>
/// <param name="MostPlayedWith">Teammates ranked by descending shared-team co-appearance count.</param>
/// <param name="MostPlayedAgainst">Opponents ranked by descending opposing co-appearance count.</param>
/// <param name="BestPartnerships">Teammates ranked by the subject's win percentage alongside them.</param>
/// <param name="BogeyOpponents">Opponents ranked by the subject's lowest win percentage against them.</param>
/// <param name="BibAppearances">Count of completed matches in which the subject's kickoff team wore bibs.</param>
/// <param name="Rich">The rich-tracking statistics when enabled, otherwise <see langword="null"/>.</param>
public sealed record PlayerProfile(
    Guid MembershipId,
    string DisplayName,
    MembershipState State,
    bool IsGuest,
    PlayerRecord Record,
    double? WinPercentage,
    RatingSummary Rating,
    IReadOnlyList<RatingProgressionPoint> Progression,
    int WinStreak,
    int UnbeatenStreak,
    IReadOnlyList<CoAppearance> MostPlayedWith,
    IReadOnlyList<CoAppearance> MostPlayedAgainst,
    IReadOnlyList<PairedStat> BestPartnerships,
    IReadOnlyList<PairedStat> BogeyOpponents,
    int BibAppearances,
    RichStats? Rich);
