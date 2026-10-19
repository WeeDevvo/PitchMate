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
    /// A dataset for the working-teams properties (match-read-models task 11.9): 1–2 squads of 12–20
    /// registered members, some with persisted ratings, each guaranteeing a confirmed match with
    /// <b>no</b> teams, one with a <b>single</b> team, one with an <b>empty roster</b> among two or more,
    /// one whose names are <b>empty and whitespace</b> with <b>zero</b> bib teams, one with <b>two</b>
    /// bib teams, moves and participants <b>added after</b> the proposal, and a rolled match whose
    /// working teams were moved after the lock — plus 0–4 unconstrained matches.
    /// <para>
    /// Names longer than 50 characters, which the task also lists, cannot be generated: the
    /// <c>match_team.team_name</c> column is <c>varchar(50)</c>, so no such name can be stored.
    /// </para>
    /// </summary>
    public static Gen<MatchListDatasetSpec> TeamsDataset() =>
        from count in Gen.Choose(1, 2)
        from squads in ListOfLength(count, TeamsSquad())
        select new MatchListDatasetSpec([.. squads]);

    private static Gen<MatchListDatasetSpec.SquadSpec> TeamsSquad() =>
        from registered in Gen.Choose(12, 20)
        from rated in Gen.Choose(0, registered)
        from single in Plan(registered, Gen.Constant(1), Gen.Elements("Solo", "  padded  "), bibs: 1)
        from emptyRoster in Plan(registered, Gen.Choose(2, 4), Gen.Elements("Reds", "Blues", "Greens"), bibs: 1, withEmptyRoster: true)
        from blankNames in Plan(registered, Gen.Choose(2, 3), Gen.Elements(string.Empty, "   ", "	"), bibs: 0)
        from twoBibs in Plan(registered, Gen.Choose(2, 3), Gen.Elements("Reds", "Blues"), bibs: 2, withMoves: true, addedAfter: true)
        from extraCount in Gen.Choose(0, 4)
        from extras in ListOfLength(extraCount, MatchOf(registered, 0))
        from days in DistinctOffsets(1)
        select new MatchListDatasetSpec.SquadSpec(
            registered,
            [
                new MatchListDatasetSpec.MatchSpec(MatchState.Confirmed, days, ParticipantCount: 4),
                single,
                emptyRoster,
                blankNames,
                twoBibs,
                new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, days, ParticipantCount: 11, MoveAfterLock: true),
                .. extras.Select(static match => match with { SoftDeleted = false }),
            ],
            RatedCount: rated);

    /// <summary>
    /// A confirmed match carrying an unlocked team plan over 4–10 registered participants, partitioned
    /// at random (a team may be empty unless the plan must avoid it).
    /// </summary>
    private static Gen<MatchListDatasetSpec.MatchSpec> Plan(
        int registered,
        Gen<int> teamCounts,
        Gen<string> names,
        int bibs,
        bool withEmptyRoster = false,
        bool withMoves = false,
        bool addedAfter = false) =>
        from teamCount in teamCounts
        from participants in Gen.Choose(Math.Max(4, teamCount), Math.Min(10, registered - 2))
        from cuts in ListOfLength(teamCount - 1, Gen.Choose(0, participants))
        from teamNames in ListOfLength(teamCount, names)
        from moveCount in Gen.Choose(withMoves ? 1 : 0, withMoves ? 3 : 0)
        from moves in ListOfLength(moveCount,
            from participant in Gen.Choose(0, participants - 1)
            from toTeam in Gen.Choose(0, teamCount - 1)
            select (participant, toTeam))
        from late in Gen.Choose(addedAfter ? 1 : 0, addedAfter ? 2 : 0)
        from days in DistinctOffsets(1)
        let sizes = Sizes(participants, cuts, withEmptyRoster)
        select new MatchListDatasetSpec.MatchSpec(
            MatchState.Confirmed,
            days,
            ParticipantCount: participants,
            Teams: new MatchListDatasetSpec.TeamPlan(
                [.. Enumerable.Range(0, teamCount).Select(index => new MatchListDatasetSpec.PlannedTeam(teamNames[index], index < bibs, sizes[index]))],
                moves,
                late));

    /// <summary>
    /// Team sizes from sorted cut points. With <paramref name="withEmptyRoster"/> the last team is
    /// forced empty and its share given to the first.
    /// </summary>
    private static IReadOnlyList<int> Sizes(int participants, IReadOnlyList<int> cuts, bool withEmptyRoster)
    {
        List<int> bounds = [0, .. cuts.Order(), participants];
        List<int> sizes = [.. bounds.Zip(bounds.Skip(1), static (from, to) => to - from)];

        if (withEmptyRoster)
        {
            sizes[0] += sizes[^1];
            sizes[^1] = 0;
        }

        return sizes;
    }

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
    /// working teams that were never locked, one confirmed match whose roster has gaps, and 0–3 extras.
    /// </summary>
    private static Gen<MatchListDatasetSpec.SquadSpec> SpineSquad() =>
        // At least ten memberships, so the rolled states are reachable.
        from pools in Pools(minimumTotal: MinimumRolled)
        from spine in Sequence(AllStates.Select(state => MatchOf(pools.Registered, pools.Guests, Gen.Constant(state))))
        from deleted in MatchOf(pools.Registered, pools.Guests)
        from unlocked in MatchOf(pools.Registered, pools.Guests, Gen.Constant(MatchState.Confirmed), teamsPercent: 100)
        from gappedDays in DistinctOffsets(1)
        from gappedMarks in Marks(pools.Registered, 1)
        from extraCount in Gen.Choose(0, MaximumMatchesPerSquad - AllStates.Length - 3)
        from extras in ListOfLength(extraCount, MatchOf(pools.Registered, pools.Guests))
        from anonymised in Gen.Choose(0, 3)
        from order in Gen.Choose(0, 1_000_000)
        // Four registered participants survive two removals from the middle of the roster, so the
        // dataset always carries a gapped roster (Requirement 2.4).
        let gapped = new MatchListDatasetSpec.MatchSpec(
            MatchState.Confirmed, gappedDays, ParticipantCount: 4, RemovedParticipantCount: 2, AvailabilityMarks: gappedMarks)
        select new MatchListDatasetSpec.SquadSpec(
            pools.Registered,
            Shuffle([.. spine.Select(match => match with { SoftDeleted = false }), deleted with { SoftDeleted = true }, unlocked with { SoftDeleted = false }, gapped, .. extras], order),
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
        let registeredParticipants = participants - guestParticipants
        from removed in Gen.Choose(0, Math.Min(2, Math.Min(registered - registeredParticipants, registeredParticipants)))
        from marks in Marks(registered, dayCount)
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
            CancelFromRolled: needsTeams && state == MatchState.Cancelled,
            RemovedParticipantCount: state == MatchState.GatheringAvailability ? 0 : removed,
            AvailabilityMarks: marks);

    /// <summary>
    /// Stored availability responses for a match's registered members (match-read-models task 10.9).
    /// Every match carries at least one member marking one or more days (member 0), one storing a
    /// response that marks <b>no</b> day (member 1), and one storing <b>no</b> response (member 2);
    /// members 3 to 7 each draw one of the three at random, and the rest store nothing.
    /// </summary>
    private static Gen<IReadOnlyList<MatchListDatasetSpec.AvailabilityMark>> Marks(int registered, int dayCount) =>
        from first in NonEmptyDaySubset(dayCount)
        from rest in Sequence(Enumerable.Range(3, Math.Max(0, Math.Min(registered, 8) - 3)).Select(member =>
            from kind in Gen.Choose(0, 2)
            from days in NonEmptyDaySubset(dayCount)
            select kind == 0
                ? null
                : new MatchListDatasetSpec.AvailabilityMark(member, kind == 1 ? [] : days)))
        select (IReadOnlyList<MatchListDatasetSpec.AvailabilityMark>)
        [
            new MatchListDatasetSpec.AvailabilityMark(0, first),
            new MatchListDatasetSpec.AvailabilityMark(1, []),
            .. rest.OfType<MatchListDatasetSpec.AvailabilityMark>(),
        ];

    /// <summary>A non-empty subset of a match's candidate-day indexes.</summary>
    private static Gen<IReadOnlyList<int>> NonEmptyDaySubset(int dayCount) =>
        from mask in Gen.Choose(1, (1 << Math.Min(dayCount, 14)) - 1)
        select (IReadOnlyList<int>)[.. Enumerable.Range(0, dayCount).Where(index => (mask & (1 << index)) != 0)];

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
