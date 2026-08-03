using PitchMate.Domain.Rating;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// A single participant offered to <see cref="ITeamBalancer"/> for team balancing: the participant's
/// squad-membership identity paired with its current rating (μ, σ). The balancer consumes only the
/// <see cref="Rating"/> — via <see cref="IRatingEngine.Predict"/> — to score candidate splits, and
/// echoes the <see cref="SquadMembershipId"/> back in the produced assignment (Requirement 8.1, 8.8).
/// </summary>
/// <param name="SquadMembershipId">The identity of the participating squad membership.</param>
/// <param name="Rating">The participant's current rating (μ, σ) used to score candidate splits.</param>
public readonly record struct BalancerParticipant(Guid SquadMembershipId, Rating Rating);
