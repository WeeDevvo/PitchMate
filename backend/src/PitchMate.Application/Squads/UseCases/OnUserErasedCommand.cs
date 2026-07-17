namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request raised by the auth-and-identity erasure path when a user is erased, so the squad
/// subsystem can apply the anonymise-vs-remove rule to every membership that user backs
/// (Requirement 18.3, 18.4). Each of the user's history-bearing memberships is anonymised with its
/// user reference cleared, and each with no history is permanently removed.
/// </summary>
/// <param name="UserId">The user being erased.</param>
public sealed record OnUserErasedCommand(Guid UserId);
