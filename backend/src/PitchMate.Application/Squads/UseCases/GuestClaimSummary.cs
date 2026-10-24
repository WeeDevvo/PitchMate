namespace PitchMate.Application.Squads.UseCases;

/// <summary>One membership's claim status, for the squad's admins.</summary>
/// <param name="MembershipId">The guest membership, or the membership a completed claim bound.</param>
/// <param name="Status">Where the claim stands.</param>
/// <param name="ExpiresAt">When the link stops (or stopped) working; set while a link is out.</param>
/// <param name="AcceptedByName">
/// The account name of the player who accepted, set only while the claim awaits completion, so the admin
/// can confirm it is the right person. Shown only to admins, because the player isn't a member yet.
/// </param>
public sealed record GuestClaimSummary(
    Guid MembershipId,
    GuestClaimStatus Status,
    DateTimeOffset? ExpiresAt,
    string? AcceptedByName);
