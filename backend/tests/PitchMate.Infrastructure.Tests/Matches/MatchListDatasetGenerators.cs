using FsCheck;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// FsCheck generators for the match list model-based properties (match-read-models task 7.1). Every
/// generated spec is seedable: participant counts respect the squad's pools, a match is driven only to
/// states its participants allow, and candidate days are 1 to 14 distinct strictly-positive offsets.
/// <para>
/// The ranges follow the task: 2–3 squads, 8–20 memberships per squad, 0–12 matches per squad spanning
/// every <see cref="MatchState"/>, with soft-deleted matches, anonymised and non-anonymised memberships,
/// guest and registered participants, candidate days supplied out of order, equal scheduling instants,
/// and locked and unlocked lineups. Where a property depends on one of those being present, the
/// matching generator <em>guarantees</em> it rather than leaving it to chance, and the test asserts it.
/// </para>
/// </summary>
internal static class MatchListDatasetGenerators
{
    /// <summary>The fewest memberships a generated squad holds.</summary>
    public const int MinimumMembers = 8;

    /// <summary>The most memberships a generated squad holds.</summary>
    public const int MaximumMembers = 20;

    /// <summary>The most matches a generated squad holds.</summary>
    public const int MaximumMatchesPerSquad = 12;

    /// <summary>The smallest two-team roster a lock admits.</summary>
    private const int MinimumRolled = Match.TeamMinSize * 2;

    /// <summary>The largest two-team roster a lock admits.</summary>
    private const int MaximumRolled = Match.TeamMaxSize * 2;

    /// <summary>The range candidate-day offsets are drawn from, in whole days after the anchor.</summary>
    private const int DayOffsetRange = 60;

    private static readonly MatchState[] AllStates = Enum.GetValues<MatchState>();

    /// <summary>
    /// A dataset of 2–3 squads whose first squad carries one match in <b>every</b> lifecycle state plus
    /// a soft-deleted match, so each case exercises the whole state space and the soft-delete clause;
    /// the other squads are unconstrained, and their matches interleave with the first's by
    /// construction (every squad draws its days from the same range).
    /// </summary>
    public static Gen<MatchListDatasetSpec> Dataset() =>
        from spine in SpineSquad()
        from otherCount in Gen.Choose(1, 2)
        from others in ListOfLength(otherCount, Squad())
        select new MatchListDatasetSpec([spine, .. others]);

    /// <summary>
    /// One squad of 2–12 matches guaranteeing at least one pair with <b>equal</b> scheduling instants
    /// (an exact copy of a match's days and confirmed day) and at least one draft whose candidate days
    /// are stored in <b>strictly descending</b> order, so neither the identity tie-break nor the
    /// "earliest candidate day" clause is satisfied by accident.
    /// </summary>
    public static Gen<MatchListDatasetSpec> TiedSquadDataset() =>
        from pools in Pools()
        from tied in MatchOf(pools.Registered, pools.Guests)
        from unsortedCount in Gen.Choose(2, 5)
        from unsortedDays in DistinctOffsets(unsortedCount)
        from extraCount in Gen.Choose(0, MaximumMatchesPerSquad - 3)
        from extras in ListOfLength(extraCount, MatchOf(pools.Registered, pools.Guests))
        from anonymised in Gen.Choose(0, 3)
        let twin = tied with { SoftDeleted = false }
        let unsorted = new MatchListDatasetSpec.MatchSpec(
            MatchState.GatheringAvailability,
            [.. unsortedDays.OrderByDescending(day => day)])
        select new MatchListDatasetSpec(
        [
            new MatchListDatasetSpec.SquadSpec(
                pools.Registered,
                [twin, twin, unsorted, .. extras],
                GuestCount: pools.Guests,
                AnonymisedCount: anonymised)
        ]);

    /// <summary>
    /// One squad holding <paramref name="admitted"/> admitted drafts plus 0–3 soft-deleted ones, for
    /// the bound and truncation property. Drafts are the cheapest match to seed in bulk and the limit
    /// is indifferent to state; their days may coincide, which the identity tie-break must resolve.
    /// </summary>
    /// <param name="admitted">The number of matches the read must admit.</param>
    public static Gen<MatchListDatasetSpec> BoundDataset(int admitted) =>
        from days in ListOfLength(admitted, DraftDays())
        from deletedCount in Gen.Choose(0, 3)
        from deleted in ListOfLength(deletedCount, DraftDays())
        select new MatchListDatasetSpec(
        [
            new MatchListDatasetSpec.SquadSpec(
                MemberCount: 2,
                Matches:
                [
                    .. days.Select(offsets => new MatchListDatasetSpec.MatchSpec(MatchState.GatheringAvailability, offsets)),
                    .. deleted.Select(offsets => new MatchListDatasetSpec.MatchSpec(
                        MatchState.GatheringAvailability, offsets, SoftDeleted: true))
                ])
        ]);

    /// <summary>
    /// The admitted-match counts the bound property draws from: the small range most squads live in,
    /// and the three cases either side of <see cref="MatchListLimits.MaximumEntries"/>.
    /// </summary>
    public static Gen<int> BoundSizes() =>
        Gen.OneOf(
            Gen.Choose(0, MaximumMatchesPerSquad),
            Gen.Elements(
                MatchListLimits.MaximumEntries - 1,
                MatchListLimits.MaximumEntries,
                MatchListLimits.MaximumEntries + 1));

    /// <summary>
    /// A squad whose matches span all six states, plus one soft-deleted match, one confirmed match with
    /// working teams that were never locked, and 0–4 extras.
    /// </summary>
    private static Gen<MatchListDatasetSpec.SquadSpec> SpineSquad() =>
        // At least ten memberships, so the rolled states are reachable.
        from pools in Pools(minimumTotal: MinimumRolled)
        from spine in Sequence(AllStates.Select(state => MatchOf(pools.Registered, pools.Guests, Gen.Constant(state))))
        from deleted in MatchOf(pools.Registered, pools.Guests)
        from unlocked in MatchOf(pools.Registered, pools.Guests, Gen.Constant(MatchState.Confirmed), teamsPercent: 100)
        from extraCount in Gen.Choose(0, MaximumMatchesPerSquad - AllStates.Length - 2)
        from extras in ListOfLength(extraCount, MatchOf(pools.Registered, pools.Guests))
        from anonymised in Gen.Choose(0, 3)
        from order in Gen.Choose(0, 1_000_000)
        select new MatchListDatasetSpec.SquadSpec(
            pools.Registered,
            Shuffle([.. spine.Select(match => match with { SoftDeleted = false }), deleted with { SoftDeleted = true }, unlocked with { SoftDeleted = false }, .. extras], order),
            GuestCount: pools.Guests,
            AnonymisedCount: anonymised);

    /// <summary>An unconstrained squad of 0–12 matches.</summary>
    private static Gen<MatchListDatasetSpec.SquadSpec> Squad() =>
        from pools in Pools()
        from matchCount in Gen.Choose(0, MaximumMatchesPerSquad)
        from matches in ListOfLength(matchCount, MatchOf(pools.Registered, pools.Guests))
        from anonymised in Gen.Choose(0, 3)
        select new MatchListDatasetSpec.SquadSpec(
            pools.Registered, matches, GuestCount: pools.Guests, AnonymisedCount: anonymised);

    /// <summary>A squad's registered and guest pool sizes, totalling 8–20.</summary>
    private static Gen<(int Registered, int Guests)> Pools(int minimumTotal = MinimumMembers) =>
        from total in Gen.Choose(minimumTotal, MaximumMembers)
        from guests in Gen.Choose(0, Math.Min(4, total - 4))
        select (total - guests, guests);

    /// <summary>A match in any state.</summary>
    private static Gen<MatchListDatasetSpec.MatchSpec> MatchOf(int registered, int guests) =>
        MatchOf(registered, guests, Gen.Elements(AllStates));

    /// <summary>
    /// A match driven to a state drawn from <paramref name="states"/>, with participants and team
    /// handling the state admits. A rolled state with too small a pool falls back to
    /// <see cref="MatchState.Confirmed"/>, which only the unconstrained generators can produce.
    /// </summary>
    /// <param name="registered">The squad's registered pool size.</param>
    /// <param name="guests">The squad's guest pool size.</param>
    /// <param name="states">The states to draw from.</param>
    /// <param name="teamsPercent">
    /// The chance a confirmed or cancelled match is given two teams (unlocked, or locked before the
    /// cancel), when the pool is large enough.
    /// </param>
    private static Gen<MatchListDatasetSpec.MatchSpec> MatchOf(
        int registered,
        int guests,
        Gen<MatchState> states,
        int teamsPercent = 40) =>
        from drawn in states
        let pool = registered + guests
        let rolledPossible = pool >= MinimumRolled
        let state = !rolledPossible && IsRolled(drawn) ? MatchState.Confirmed : drawn
        from wide in Chance(15)
        from dayCount in Gen.Choose(1, wide ? 14 : 4)
        from days in DistinctOffsets(dayCount)
        from confirmedIndex in Gen.Choose(0, dayCount - 1)
        from withTeams in Chance(rolledPossible ? teamsPercent : 0)
        let needsTeams = IsRolled(state) || (withTeams && state is MatchState.Confirmed or MatchState.Cancelled)
        from participants in ParticipantCount(state, needsTeams, pool)
        from guestParticipants in Gen.Choose(Math.Max(0, participants - registered), Math.Min(guests, participants))
        from completedOffset in Gen.Choose(0, 10_000)
        from softDeleted in Chance(15)
        select new MatchListDatasetSpec.MatchSpec(
            state,
            days,
            confirmedIndex,
            participants,
            softDeleted,
            completedOffset,
            guestParticipants,
            ProposeTeamsWithoutLock: needsTeams && state == MatchState.Confirmed,
            CancelFromRolled: needsTeams && state == MatchState.Cancelled);

    /// <summary>The participant count a state admits: none while gathering, 10–16 with teams.</summary>
    private static Gen<int> ParticipantCount(MatchState state, bool needsTeams, int pool) =>
        state == MatchState.GatheringAvailability
            ? Gen.Constant(0)
            : needsTeams
                ? Gen.Choose(MinimumRolled, Math.Min(MaximumRolled, pool))
                : Gen.Choose(0, Math.Min(MaximumRolled, pool));

    /// <summary>The states a match reaches only through a locked two-team lineup.</summary>
    private static bool IsRolled(MatchState state) =>
        state is MatchState.TeamsRolled or MatchState.InProgress or MatchState.Completed;

    /// <summary>One to three distinct candidate-day offsets for a bulk draft.</summary>
    private static Gen<IReadOnlyList<int>> DraftDays() =>
        from count in Gen.Choose(1, 3)
        from days in DistinctOffsets(count)
        select days;

    /// <summary>
    /// <paramref name="count"/> distinct strictly-positive day offsets in a shuffled — usually
    /// non-chronological — order.
    /// </summary>
    private static Gen<IReadOnlyList<int>> DistinctOffsets(int count) =>
        from seed in Gen.Choose(0, 1_000_000)
        select (IReadOnlyList<int>)Shuffle([.. Enumerable.Range(1, DayOffsetRange)], seed).Take(count).ToList();

    /// <summary>A deterministic Fisher–Yates shuffle driven by a generated seed.</summary>
    private static IReadOnlyList<T> Shuffle<T>(List<T> items, int seed)
    {
        var random = new System.Random(seed);
        for (int i = items.Count - 1; i > 0; i--)
        {
            int j = random.Next(i + 1);
            (items[i], items[j]) = (items[j], items[i]);
        }

        return items;
    }

    /// <summary>True with probability <paramref name="percent"/>%.</summary>
    private static Gen<bool> Chance(int percent) =>
        from roll in Gen.Choose(0, 99)
        select roll < percent;

    /// <summary>A list of exactly <paramref name="length"/> items drawn from <paramref name="element"/>.</summary>
    private static Gen<IReadOnlyList<T>> ListOfLength<T>(int length, Gen<T> element) =>
        Sequence(Enumerable.Repeat(element, Math.Max(0, length)));

    /// <summary>One draw from each generator, in order.</summary>
    private static Gen<IReadOnlyList<T>> Sequence<T>(IEnumerable<Gen<T>> generators) =>
        generators.Aggregate(
            Gen.Constant((IReadOnlyList<T>)[]),
            (acc, next) =>
                from head in acc
                from item in next
                select (IReadOnlyList<T>)[.. head, item]);
}
