using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The data returned for a squad to one of its active members (Requirement 16.1): the squad's
/// identity and name, its memberships (both active and inactive), and every feature's current
/// state. Squad-scoped rating and stats content is added by later specs; this spec exposes the
/// membership and feature-flag surface those specs hang off.
/// </summary>
/// <param name="SquadId">The squad's identity.</param>
/// <param name="Name">The squad's trimmed name.</param>
/// <param name="Members">The squad's memberships, active and inactive.</param>
/// <param name="Features">Each <see cref="SquadFeature"/> with its current enabled state.</param>
public sealed record SquadData(
    Guid SquadId,
    string Name,
    IReadOnlyList<SquadMemberView> Members,
    IReadOnlyList<SquadFeatureView> Features);

/// <summary>
/// A single membership as seen within a squad's data: its identity, display name, role (null for a
/// guest), lifecycle state, and whether it is a guest membership (Requirement 16.1).
/// </summary>
/// <param name="MembershipId">The membership's identity.</param>
/// <param name="DisplayName">The membership's display name within the squad.</param>
/// <param name="Role">The membership's role, or <see langword="null"/> for a guest membership.</param>
/// <param name="State">The membership's lifecycle state.</param>
/// <param name="IsGuest">Whether the membership is a guest (no backing user).</param>
public sealed record SquadMemberView(
    Guid MembershipId,
    string DisplayName,
    SquadRole? Role,
    MembershipState State,
    bool IsGuest);

/// <summary>The enabled state of a single <see cref="SquadFeature"/> for a squad (Requirement 16.1).</summary>
/// <param name="Feature">The feature.</param>
/// <param name="IsEnabled">Whether the feature is enabled for the squad.</param>
public sealed record SquadFeatureView(SquadFeature Feature, bool IsEnabled);

/// <summary>
/// A summary of one squad in the authenticated user's squad list (Requirement 16.4): the squad's
/// identity and name, together with the role and state of the user's own membership in it.
/// </summary>
/// <param name="SquadId">The squad's identity.</param>
/// <param name="Name">The squad's trimmed name.</param>
/// <param name="Role">The user's role in the squad, or <see langword="null"/> if none.</param>
/// <param name="State">The user's membership state in the squad, or <see langword="null"/> if unknown.</param>
public sealed record MySquadSummary(
    Guid SquadId,
    string Name,
    SquadRole? Role,
    MembershipState? State);
