namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The identity produced by a successful guest creation: the new active guest membership
/// (Requirement 14.1).
/// </summary>
/// <param name="GuestMembershipId">The identity of the created guest membership.</param>
public sealed record CreateGuestResult(Guid GuestMembershipId);
