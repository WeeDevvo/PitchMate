namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// The output of <see cref="ITeamBalancer.ProposeAsync"/>: the chosen assignment of participants to
/// teams together with the split's predicted outcome — a per-team win probability (carried on each
/// <see cref="ProposedTeamAssignment"/>) and a single, independently computed draw probability
/// excluded from the win-probability sum, mirroring <see cref="Domain.Rating.MatchPrediction"/>
/// (Requirement 8.1). The admin can adjust, re-roll, or lock the proposal; producing it never alters
/// any rating (<c>product.md</c> "Team balancing").
/// </summary>
/// <param name="Teams">The proposed teams, each carrying its ordered roster and predicted win probability.</param>
/// <param name="DrawProbability">The predicted draw probability for the split, in [0, 1], excluded from the win-probability sum.</param>
public sealed record TeamProposal(
    IReadOnlyList<ProposedTeamAssignment> Teams,
    double DrawProbability);
