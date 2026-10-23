namespace PitchMate.Application.Squads.UseCases;

/// <summary>A request by an owner or admin to issue a claim link for a guest.</summary>
/// <param name="ActingUserId">The authenticated user issuing the link.</param>
/// <param name="SquadId">The squad the guest belongs to.</param>
/// <param name="MembershipId">The guest membership the link will claim.</param>
public sealed record InitiateGuestClaimCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MembershipId);
