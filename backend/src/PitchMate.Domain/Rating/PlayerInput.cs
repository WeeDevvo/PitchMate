namespace PitchMate.Domain.Rating;

/// <summary>
/// A player's contribution to a team result. Participation is consulted only when the
/// participation-weighting lever is enabled.
/// </summary>
/// <param name="Rating">The player's rating going into the match.</param>
/// <param name="Participation">Optional participation fraction in [0, 1]; used only when the participation lever is enabled.</param>
public sealed record PlayerInput(Rating Rating, double? Participation = null);
