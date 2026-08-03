using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// Proposes a fair split of a match's participants into teams. Declared in Application; implemented
/// in Infrastructure, where it consumes only <see cref="Domain.Rating.IRatingEngine.Predict"/> over
/// candidate rosters and performs no rating arithmetic itself (Requirement 8.1, 8.8). Its objective
/// is a fair contest — minimising the gap from a 50/50 predicted result, tie-broken toward less skill
/// concentration — and its internal search strategy is out of this spec's scope (<c>product.md</c>
/// "Team balancing").
/// </summary>
public interface ITeamBalancer
{
    /// <summary>
    /// Proposes an assignment of the participants in <paramref name="request"/> into the requested
    /// number of teams, returning the split together with its predicted per-team win and draw
    /// probabilities (Requirement 8.1). The proposal partitions the participants exactly — every
    /// participant on exactly one team, none unassigned, none duplicated (Requirement 8.2). Producing
    /// a proposal changes no match state and alters no rating. An invalid request (for example fewer
    /// than two teams, or too few participants to fill them) yields a validation failure and no
    /// proposal.
    /// </summary>
    /// <param name="request">The participants to split and the desired team count.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>A success carrying the <see cref="TeamProposal"/>, or a validation failure that produces no proposal.</returns>
    Task<Result<TeamProposal>> ProposeAsync(TeamBalanceRequest request, CancellationToken cancellationToken);
}
