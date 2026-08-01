using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for deriving the ranked match outcome from the recorded scores
/// (match-lifecycle design Property 14).
/// <para>
/// For any match result at either fidelity, the <see cref="Match.DeriveOutcome"/> result assigns
/// ranks so that a strictly higher final score is a strictly better (numerically lower) rank and
/// teams with equal final scores receive equal ranks — a draw — for both
/// <see cref="ResultFidelity.Basic"/> and <see cref="ResultFidelity.Rich"/> fidelity
/// (Requirement 11.2, 11.3, 12.3). The ranking is standard competition ranking: a team's rank equals
/// one plus the number of teams with a strictly higher score.
/// </para>
/// <para>
/// The test drives a match into <see cref="MatchState.InProgress"/> with two or three locked teams of
/// generated (5..8) sizes, each participant carrying a distinct supplied rating so the produced
/// outcome can be checked to align one-to-one and in order with the captured
/// <see cref="KickoffLineup"/> teams and their rosters. Per-team scores are drawn from a small range
/// so ties <em>and</em> strict orderings both arise across the sample. The same match is scored at
/// <see cref="ResultFidelity.Basic"/> and then at <see cref="ResultFidelity.Rich"/> with identical
/// scores, and the two derived rankings are asserted to be identical, confirming fidelity does not
/// affect ranking (Requirement 11.3). The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchOutcomeRankingPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the candidate day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A fixed, strictly-positive uncertainty used for every supplied participant rating.</summary>
    private const double Sigma = 25.0 / 3.0;

    // Feature: match-lifecycle, Property 14: The match outcome ranks teams by score with draws as
    // equal ranks - for any match result at either fidelity, the derived MatchOutcome assigns ranks so
    // that a strictly higher final score is a strictly better (lower) rank and teams with equal final
    // scores receive equal ranks (a draw), for both Basic and Rich fidelity.
    // Validates: Requirements 11.2, 11.3, 12.3
    [Property(MaxTest = 100)]
    [Trait("Property", "14")]
    public Property MatchOutcomeRanksTeamsByScoreWithDrawsAsEqualRanks() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var match = InProgressMatch(squadId, scenario.Sizes, out var teamIds, out var ratingsByMembershipId, out var rosters);

            // Record and derive at Basic fidelity, then re-record and derive at Rich fidelity with the
            // identical scores against the same match, so the two rankings can be compared directly.
            var basic = DeriveWithScores(match, teamIds, scenario.Scores, ResultFidelity.Basic, ratingsByMembershipId);
            var rich = DeriveWithScores(match, teamIds, scenario.Scores, ResultFidelity.Rich, ratingsByMembershipId);

            if (!basic.IsSuccess || !rich.IsSuccess)
            {
                return false;
            }

            var basicTeams = basic.Value!.Teams;
            var richTeams = rich.Value!.Teams;

            // One ranked team per kickoff team, in the captured kickoff order.
            if (basicTeams.Count != scenario.Sizes.Count || richTeams.Count != scenario.Sizes.Count)
            {
                return false;
            }

            for (var i = 0; i < scenario.Sizes.Count; i++)
            {
                // Teams align one-to-one and in order with the kickoff-lineup teams: the outcome team at
                // index i carries exactly the roster of kickoff team i, in order, with the supplied
                // ratings (confirming order alignment via the distinct per-participant ratings).
                if (!PlayersMatchRoster(basicTeams[i], rosters[i], ratingsByMembershipId)
                    || !PlayersMatchRoster(richTeams[i], rosters[i], ratingsByMembershipId))
                {
                    return false;
                }

                // Competition ranking: rank = 1 + number of teams with a strictly higher score.
                var expectedRank = 1 + scenario.Scores.Count(other => other > scenario.Scores[i]);
                if (basicTeams[i].Rank != expectedRank || richTeams[i].Rank != expectedRank)
                {
                    return false;
                }

                // Fidelity does not affect ranking: Basic and Rich agree at every position.
                if (basicTeams[i].Rank != richTeams[i].Rank)
                {
                    return false;
                }
            }

            // Pairwise: strictly higher score => strictly better (lower) rank; equal scores => equal ranks.
            for (var i = 0; i < scenario.Sizes.Count; i++)
            {
                for (var j = 0; j < scenario.Sizes.Count; j++)
                {
                    if (scenario.Scores[i] > scenario.Scores[j] && !(basicTeams[i].Rank < basicTeams[j].Rank))
                    {
                        return false;
                    }

                    if (scenario.Scores[i] == scenario.Scores[j] && basicTeams[i].Rank != basicTeams[j].Rank)
                    {
                        return false;
                    }
                }
            }

            return true;
        });

    /// <summary>
    /// Records a result carrying <paramref name="scores"/> against <paramref name="teamIds"/> at
    /// <paramref name="fidelity"/> (live tracking enabled so the fidelity gate never fires) and returns
    /// the derived outcome over <paramref name="ratingsByMembershipId"/>. A failed recording leaves the
    /// prior recorded result in place, so the returned derivation still reflects a valid, recorded
    /// result and any unexpected recording failure surfaces as a failed derivation.
    /// </summary>
    private static PitchMate.Domain.Matches.Result<PitchMate.Domain.Rating.MatchOutcome> DeriveWithScores(
        Match match,
        IReadOnlyList<Guid> teamIds,
        IReadOnlyList<int> scores,
        ResultFidelity fidelity,
        IReadOnlyDictionary<Guid, PlayerRating> ratingsByMembershipId)
    {
        var teamScores = teamIds.Select((id, i) => new TeamScore(id, scores[i])).ToList();
        match.RecordResult(new MatchResult(fidelity, teamScores), liveTrackingEnabled: true);
        return match.DeriveOutcome(ratingsByMembershipId);
    }

    /// <summary>
    /// Whether <paramref name="team"/>'s players are exactly the ratings of <paramref name="roster"/>'s
    /// memberships, in roster order, confirming the outcome team aligns with its kickoff team.
    /// </summary>
    private static bool PlayersMatchRoster(
        PitchMate.Domain.Rating.TeamResult team,
        IReadOnlyList<Guid> roster,
        IReadOnlyDictionary<Guid, PlayerRating> ratingsByMembershipId)
    {
        if (team.Players.Count != roster.Count)
        {
            return false;
        }

        for (var k = 0; k < roster.Count; k++)
        {
            if (team.Players[k].Rating != ratingsByMembershipId[roster[k]])
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Builds a match drafted and confirmed for <paramref name="squadId"/>, populated with one team per
    /// entry of <paramref name="sizes"/> (each carrying that many participants), locked with the first
    /// team wearing bibs, and started, leaving it in <see cref="MatchState.InProgress"/> with a captured
    /// kickoff lineup. Exposes the working teams' identities (in kickoff order) via
    /// <paramref name="teamIds"/>, a per-participant rating dictionary via
    /// <paramref name="ratingsByMembershipId"/>, and each team's ordered roster via
    /// <paramref name="rosters"/>.
    /// </summary>
    private static Match InProgressMatch(
        Guid squadId,
        IReadOnlyList<int> sizes,
        out IReadOnlyList<Guid> teamIds,
        out IReadOnlyDictionary<Guid, PlayerRating> ratingsByMembershipId,
        out IReadOnlyList<IReadOnlyList<Guid>> rosters)
    {
        var day = NowUtc.AddDays(7);
        var match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

        var ratings = new Dictionary<Guid, PlayerRating>();
        var teamRosters = new List<IReadOnlyList<Guid>>(sizes.Count);
        var proposal = new List<ProposedTeam>(sizes.Count);

        for (var t = 0; t < sizes.Count; t++)
        {
            var roster = new List<Guid>(sizes[t]);
            for (var p = 0; p < sizes[t]; p++)
            {
                var membership = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {t}-{p}").Value!;
                match.AddParticipant(membership);
                roster.Add(membership.Id);

                // A distinct mean per participant so roster order/alignment is observable in the outcome.
                ratings[membership.Id] = new PlayerRating(Mu: (t * 100) + p, Sigma: Sigma);
            }

            teamRosters.Add(roster);
            proposal.Add(new ProposedTeam($"Team {t}", BibFlag: t == 0, roster));
        }

        match.ApplyTeamProposal(proposal);
        match.Lock();
        match.Start();

        teamIds = match.Teams.Select(team => team.Id).ToList();
        ratingsByMembershipId = ratings;
        rosters = teamRosters;
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated ranking scenario: each team's size and each team's final score, index-aligned.</summary>
    private sealed record Scenario(IReadOnlyList<int> Sizes, IReadOnlyList<int> Scores);

    /// <summary>
    /// Generates a scenario for two or three teams. Each team's size is 5..8 (a valid, possibly uneven
    /// lock such as 7v6), and each team's score is drawn from a small range (0..3) so ties and strict
    /// orderings both arise frequently across the sample, exercising both the draw and the
    /// strictly-better-rank branches of the ranking.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from teamCount in Gen.Choose(2, 3)
        from sizes in ListOfLength(teamCount, Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize))
        from scores in ListOfLength(teamCount, Gen.Choose(0, 3))
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
