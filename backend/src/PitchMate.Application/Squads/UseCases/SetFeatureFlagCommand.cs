using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an owner or admin to enable or disable a single <see cref="SquadFeature"/> for their
/// squad (Requirement 13.2, 13.7). The acting user must hold an active <c>Owner</c> or <c>Admin</c>
/// membership in the target squad; <paramref name="Feature"/> must be a defined
/// <see cref="SquadFeature"/> member (Requirement 13.6).
/// </summary>
/// <param name="ActingUserId">The authenticated user toggling the feature.</param>
/// <param name="SquadId">The squad whose feature is toggled.</param>
/// <param name="Feature">The feature to enable or disable.</param>
/// <param name="Enabled">The requested enabled state.</param>
public sealed record SetFeatureFlagCommand(
    Guid ActingUserId,
    Guid SquadId,
    SquadFeature Feature,
    bool Enabled);
