namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of an ownership-transfer request (Requirement 6). The acting user (the current owner) is
/// resolved from the access token; the body names the membership that becomes the new owner.
/// </summary>
/// <param name="TargetMembershipId">The membership to promote to <c>Owner</c>.</param>
public sealed record TransferOwnershipRequest(Guid TargetMembershipId);
