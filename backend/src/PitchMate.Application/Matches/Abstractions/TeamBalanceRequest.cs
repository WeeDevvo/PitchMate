namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// The input to <see cref="ITeamBalancer.ProposeAsync"/>: the participants to split (each with its
/// current rating) and the number of teams to form. For the MVP the UI forms two teams
/// (<see cref="TeamCount"/> = 2), but the abstraction is N-team capable to keep "winner-stays-on" /
/// three-team rotation formats open (Requirement 8.1, <c>product.md</c> "Team balancing"). The
/// balancer scores candidate splits with <see cref="Domain.Rating.IRatingEngine.Predict"/> and
/// performs no rating arithmetic itself (Requirement 8.8).
/// </summary>
/// <param name="Participants">The participants to distribute across teams, each carrying its current rating.</param>
/// <param name="TeamCount">The desired number of teams to form (2 for the MVP).</param>
public sealed record TeamBalanceRequest(
    IReadOnlyList<BalancerParticipant> Participants,
    int TeamCount);
