namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The identity produced by a successful guest-claim initiation: the new pending
/// <c>GuestClaim</c> audit record (Requirement 15.1, 15.5).
/// </summary>
/// <param name="ClaimId">The identity of the created guest claim.</param>
public sealed record InitiateGuestClaimResult(Guid ClaimId);
