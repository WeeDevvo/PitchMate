using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property tests for the outcome shares organisers see (<see cref="OutcomeShares"/>): for any engine
/// prediction (wins summing to 1, a draw in [0, 1]) the shown wins plus the draw sum to 1, the draw is
/// unchanged, and the teams keep their relative strength. The working teams' prediction and the
/// balancer's proposal get the same shares, and the proposal keeps its rosters.
/// </summary>
public class OutcomeSharesPropertyTests
{
    private const double Tolerance = 1e-9;

    /// <summary>Two to four teams' engine wins, normalised to sum to 1, and a draw probability.</summary>
    private static Arbitrary<(double[] Wins, double Draw)> Predictions() =>
        Arb.From(
            from teams in Gen.Choose(2, 4)
            from weights in Gen.ArrayOf(Gen.Choose(1, 1000), teams)
            from drawPermille in Gen.Choose(0, 1000)
            let total = (double)weights.Sum()
            select (weights.Select(weight => weight / total).ToArray(), drawPermille / 1000.0));

    [Property(MaxTest = 200)]
    public Property WinsAndDrawMakeTheWholeOutcome_KeepingTheTeamsRelativeStrength() =>
        Prop.ForAll(Predictions(), prediction =>
        {
            (double[] wins, double draw) = prediction;
            SplitPrediction shares = SplitPrediction.FromEngine(wins, draw);

            Assert.Equal(draw, shares.DrawProbability);
            Assert.Equal(1.0, shares.WinProbabilities.Sum() + shares.DrawProbability, Tolerance);
            for (var i = 0; i < wins.Length; i++)
            {
                Assert.Equal(wins[i] * (1.0 - draw), shares.WinProbabilities[i], Tolerance);
                Assert.InRange(shares.WinProbabilities[i], 0.0, 1.0);
            }
        });

    [Property(MaxTest = 200)]
    public Property AProposalGetsTheSameSharesAsTheWorkingTeams_AndKeepsItsRosters() =>
        Prop.ForAll(Predictions(), prediction =>
        {
            (double[] wins, double draw) = prediction;
            var proposal = new TeamProposal(
                [.. wins.Select(win => new ProposedTeamAssignment([Guid.CreateVersion7()], win))],
                draw);

            TeamProposal shown = ProposeTeamsHandler.AsOutcomeShares(proposal);

            Assert.Equal(draw, shown.DrawProbability);
            Assert.Equal(SplitPrediction.FromEngine(wins, draw).WinProbabilities, shown.Teams.Select(team => team.WinProbability));
            Assert.Equal(proposal.Teams.Select(team => team.ParticipantMembershipIds), shown.Teams.Select(team => team.ParticipantMembershipIds));
        });
}
