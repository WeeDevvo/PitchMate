namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an authenticated user to create a new squad they will own (Requirement 1). The
/// <paramref name="Name"/> is trimmed and validated (1..80 characters) by the handler; the
/// <paramref name="DisplayName"/> is the owner's squad-facing name.
/// <para>
/// When <paramref name="DisplayName"/> is <see langword="null"/> the owner display name is derived
/// from the creating user's identity display name (Requirement 1.5); when it is non-null it is used
/// as supplied and validated to a trimmed length of 1..50 characters (Requirement 1.4, 1.6). Both
/// <paramref name="Name"/> and <paramref name="DisplayName"/> may be <see langword="null"/> so
/// malformed input is reported as a validation failure rather than throwing.
/// </para>
/// </summary>
/// <param name="CreatingUserId">The authenticated user who will own the new squad.</param>
/// <param name="Name">The requested squad name; trimmed and validated by the handler.</param>
/// <param name="DisplayName">
/// The owner's optional display name. When <see langword="null"/> it is derived from the creating
/// user's identity display name; otherwise it is used as supplied and validated.
/// </param>
public sealed record CreateSquadCommand(
    Guid CreatingUserId,
    string? Name,
    string? DisplayName = null);
