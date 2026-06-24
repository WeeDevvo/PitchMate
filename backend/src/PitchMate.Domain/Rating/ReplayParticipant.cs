namespace PitchMate.Domain.Rating;

/// <summary>
/// A participant in a replayed match, identified by an opaque index into the replay's initial rating list.
/// Identity-agnostic: the engine has no concept of memberships or accounts.
/// </summary>
/// <param name="PlayerIndex">Zero-based index into the initial rating list supplied to the replay.</param>
/// <param name="Participation">Optional participation fraction in [0, 1]; used only when the participation lever is enabled.</param>
public sealed record ReplayParticipant(int PlayerIndex, double? Participation = null);
