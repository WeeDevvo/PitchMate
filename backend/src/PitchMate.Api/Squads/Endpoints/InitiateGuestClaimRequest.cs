namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of a guest-claim initiation request (Requirement 15). The acting admin and the guest
/// membership are resolved from the access token and the route; the body names the registered user the
/// membership is being claimed onto.
/// </summary>
/// <param name="TargetUserId">The registered user the guest membership is being claimed onto.</param>
public sealed record InitiateGuestClaimRequest(Guid TargetUserId);
