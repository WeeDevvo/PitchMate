using PitchMate.Domain.Squads;

namespace PitchMate.Application.Stats;

/// <summary>
/// A lightweight reference to a subject membership proving it belongs to the target squad, returned by
/// <see cref="IStatsRepository.FindMembershipAsync"/> (which returns <see langword="null"/> when the
/// membership does not belong to the squad, so the profile handler can conceal existence with a
/// uniform failure — Requirement 3.6). It carries just enough identity and lifecycle detail for the
/// handler to seed the profile shell before aggregating statistics: identity, display name, lifecycle
/// state, and whether the membership is a guest.
/// </summary>
/// <param name="MembershipId">The membership's identity.</param>
/// <param name="DisplayName">The membership's display name within the squad ("Former player" when anonymised).</param>
/// <param name="State">The membership's lifecycle state.</param>
/// <param name="IsGuest">Whether the membership is a guest (no backing user).</param>
public sealed record MembershipRef(
    Guid MembershipId,
    string DisplayName,
    MembershipState State,
    bool IsGuest);
