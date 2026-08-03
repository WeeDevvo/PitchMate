using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;

// Within this test the unqualified name `Rating` would otherwise be ambiguous with the sibling
// namespace PitchMate.Domain.Rating; alias the rating value type explicitly (as Match.cs does).
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based test for the kickoff lineup as the sole rating input (match-lifecycle design
/// Property 13).
/// <para>
/// For any completed match, the <see cref="MatchOutcome"/> fed to the rating engine is derived
/// <em>solely</em> from the captured <see cref="KickoffLineup"/>: it contains one ranked team per
/// kickoff team (same count, same order), includes every kickoff participant in exactly one team,
/// and includes no participant absent from the kickoff lineup; the derived team rosters correspond
/// to the captured kickoff rosters — not to the working teams (Requirements 10.1, 10.2, 10.3, 10.4,
/// 12.2).
/// </para>
/// <para>
/// The aggregate exposes no post-lock <em>stats-only participation</em> surface — late arrivals,
/// leavers, and substitutions are out of this spec's scope, and participant add/remove is gated to
/// <see cref="MatchState.Confirmed"/>. The one post-lock mutation the aggregate does permit is a
/// working-team roster edit while still in <see cref="MatchState.TeamsRolled"/> (a re-mix before
/// kickoff). The test uses that as the strongest available exercise of the invariant: after locking
/// it moves a participant between the working teams, then asserts (a) the captured
/// <see cref="KickoffLineup"/> is unchanged by that edit, and (b) the outcome derived after
/// <see cref="Match.Start"/> and <see cref="Match.RecordResult"/> still reflects the original kickoff
/// rosters, proving the working-team change never enters the rating update. A participant genuinely
/// absent from the lineup is structurally impossible: <see cref="Match.ApplyTeamProposal"/> and
/// <see cref="Match.Lock"/> require every participant to sit on exactly one team, so the "no
/// non-lineup participant" clause is guaranteed by construction and asserted via the exact multiset
/// of recovered participants.
/// </para>
/// <para>
/// Each kickoff participant is given a unique μ so the anonymous <see cref="PlayerInput"/> ratings in
/// the derived outcome can be mapped back to their squad-membership identities. Team count spans 2..3
/// and team sizes 5..8 (uneven splits included); scores span 0..99. The property runs at least 100
/// iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchKickoffLineupRatingInputPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the candidate day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A fixed, strictly-positive σ shared by every generated rating; only μ distinguishes participants.</summary>
    private const double Sigma = 8.333;

    // Feature: match-lifecycle, Property 13: The kickoff lineup is immutable and is the sole rating
    // input - for any completed match, the MatchOutcome fed to the rating engine is derived solely
    // from the captured KickoffLineup: it contains one ranked team per kickoff team, includes every
    // kickoff participant in exactly one team, and includes no participant absent from the kickoff
    // lineup; stats-only participation changes after lock leave the kickoff lineup unchanged.
    // Validates: Requirements 10.1, 10.2, 10.3, 10.4, 12.2
    [Property(MaxTest = 100)]
    [Trait("Property", "13")]
    public Property KickoffLineupIsImmutableAndSoleRatingInput() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var match = ConfirmedMatch(squadId);

            // Add exactly the total number of participants and assign each a unique μ (its index), so
            // the anonymous PlayerInput ratings in the outcome can be mapped back to memberships.
            var total = scenario.Sizes.Sum();
            var membershipIds = new List<Guid>(total);
            var membershipByMu = new Dictionary<int, Guid>(total);
            var ratings = new Dictionary<Guid, PlayerRating>(total);
            for (var i = 0; i < total; i++)
            {
                var membership = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i}").Value!;
                if (!match.AddParticipant(membership).IsSuccess)
                {
                    return false;
                }

                membershipIds.Add(membership.Id);
                membershipByMu[i] = membership.Id;
                ratings[membership.Id] = new PlayerRating(Mu: i, Sigma: Sigma);
            }

            // Partition the participants into the generated teams, in order. team[t] gets the next
            // Sizes[t] participants; team 0 wears bibs; names are distinct and valid.
            var expectedRosters = new List<List<Guid>>(scenario.Sizes.Count);
            var proposal = new List<ProposedTeam>(scenario.Sizes.Count);
            var offset = 0;
            for (var t = 0; t < scenario.Sizes.Count; t++)
            {
                var roster = membershipIds.Skip(offset).Take(scenario.Sizes[t]).ToList();
                offset += scenario.Sizes[t];
                expectedRosters.Add(roster);
                proposal.Add(new ProposedTeam($"Team {t}", BibFlag: t == 0, roster));
            }

            if (!match.ApplyTeamProposal(proposal).IsSuccess || !match.Lock().IsSuccess)
            {
                return false;
            }

            // Sanity: the captured lineup mirrors the partition we locked.
            if (!LineupRostersMatch(match.KickoffLineup!, expectedRosters))
            {
                return false;
            }

            // Post-lock working-team edit while still TeamsRolled: move the first participant of
            // working team 1 onto working team 0. This mutates the working rosters but must NOT touch
            // the captured, immutable kickoff lineup (Requirement 10.2, 10.3).
            var workingTeams = match.Teams.ToList();
            var moved = workingTeams[1].Roster[0];
            if (!match.MoveParticipant(moved, workingTeams[0].Id).IsSuccess)
            {
                return false;
            }

            // Immutability: the kickoff lineup is unchanged by the working-team edit.
            if (!LineupRostersMatch(match.KickoffLineup!, expectedRosters))
            {
                return false;
            }

            if (!match.Start().IsSuccess)
            {
                return false;
            }

            // Record the result against the working teams (team order preserved; ids are stable across
            // the move), scoring team t with Scores[t].
            var teamScores = new List<TeamScore>(workingTeams.Count);
            for (var t = 0; t < workingTeams.Count; t++)
            {
                teamScores.Add(new TeamScore(workingTeams[t].Id, scenario.Scores[t]));
            }

            if (!match.RecordResult(new MatchResult(ResultFidelity.Basic, teamScores), liveTrackingEnabled: false).IsSuccess)
            {
                return false;
            }

            var derived = match.DeriveOutcome(ratings);
            if (!derived.IsSuccess)
            {
                return false;
            }

            var outcome = derived.Value!;

            // One ranked team per kickoff team, same count and order.
            if (outcome.Teams.Count != expectedRosters.Count)
            {
                return false;
            }

            var recoveredAll = new List<Guid>(total);
            for (var t = 0; t < outcome.Teams.Count; t++)
            {
                // Recover this outcome team's membership ids from the unique μ carried by each player.
                var recovered = new List<Guid>(outcome.Teams[t].Players.Count);
                foreach (var player in outcome.Teams[t].Players)
                {
                    var mu = (int)Math.Round(player.Rating.Mu);
                    if (!membershipByMu.TryGetValue(mu, out var id))
                    {
                        return false;
                    }

                    recovered.Add(id);
                }

                // The derived roster corresponds to the captured KICKOFF roster, in order — not the
                // mutated working roster (Requirement 10.4, 12.2).
                if (!recovered.SequenceEqual(expectedRosters[t]))
                {
                    return false;
                }

                recoveredAll.AddRange(recovered);
            }

            // Every kickoff participant appears exactly once across the outcome, and no participant
            // absent from the kickoff lineup is included: the recovered multiset equals exactly the
            // set of kickoff participants (Requirement 10.4, 12.2).
            return recoveredAll.Count == total
                && recoveredAll.Distinct().Count() == total
                && recoveredAll.ToHashSet().SetEquals(membershipIds);
        });

    /// <summary>Whether <paramref name="lineup"/>'s team rosters equal the expected ordered rosters.</summary>
    private static bool LineupRostersMatch(KickoffLineup lineup, IReadOnlyList<List<Guid>> expected)
    {
        if (lineup.Teams.Count != expected.Count)
        {
            return false;
        }

        for (var i = 0; i < expected.Count; i++)
        {
            if (!lineup.Teams[i].ParticipantMembershipIds.SequenceEqual(expected[i]))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Creates a match drafted for <paramref name="squadId"/> and confirmed with an empty participant
    /// pool, leaving it in <see cref="MatchState.Confirmed"/> ready for participants and team rolling.
    /// </summary>
    private static Match ConfirmedMatch(Guid squadId)
    {
        var day = NowUtc.AddDays(7);
        var match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated scenario: each team's locked size and each team's recorded final score.</summary>
    private sealed record Scenario(IReadOnlyList<int> Sizes, IReadOnlyList<int> Scores);

    /// <summary>
    /// Generates 2..3 teams, each with a valid locked size in 5..8 (uneven splits such as 7v6
    /// included) and a final score in 0..99 (equal scores, and hence draws, occur naturally).
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from teamCount in Gen.Choose(2, 3)
        from sizes in ListOfLength(teamCount, Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize))
        from scores in ListOfLength(teamCount, Gen.Choose(MatchResult.MinScore, MatchResult.MaxScore))
        select new Scenario(sizes, scores);

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    /// <summary>Returns a new list with <paramref name="head"/> prepended to <paramref name="tail"/>.</summary>
    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var list = new List<T>(tail.Count + 1) { head };
        list.AddRange(tail);
        return list;
    }
}
