using PitchMate.Domain.Squads;

namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of a feature-flag toggle request (Requirement 13). <paramref name="Feature"/> must be a
/// defined <see cref="SquadFeature"/> member; an undefined value is rejected as a validation failure.
/// The acting user is resolved from the access token.
/// </summary>
/// <param name="Feature">The feature to enable or disable.</param>
/// <param name="Enabled">The requested enabled state.</param>
public sealed record SetFeatureFlagRequest(SquadFeature Feature, bool Enabled);
