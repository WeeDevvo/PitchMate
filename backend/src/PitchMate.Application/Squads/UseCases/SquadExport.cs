using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A machine-readable extract of a squad's data, offered to the owner before purge to support the UK
/// GDPR data-portability path (Requirement 17.2). It carries the squad's identity, name, and
/// pending-deletion state together with every membership, every invite (with no redeemable secret),
/// and every feature flag's state. It deliberately contains nothing from which an invite's redeemable
/// secret can be reconstructed — the persisted one-way token hash is never surfaced.
/// </summary>
/// <param name="SquadId">The squad's identity.</param>
/// <param name="Name">The squad's trimmed name.</param>
/// <param name="IsPendingDeletion">Whether the squad is currently soft-deleted and awaiting purge.</param>
/// <param name="PurgeAt">The UTC instant at which the squad becomes eligible for purge, or <see langword="null"/> when not pending deletion.</param>
/// <param name="Memberships">Every membership in the squad, active and inactive.</param>
/// <param name="Invites">Every invite in the squad, projected without any redeemable secret.</param>
/// <param name="Features">Each <see cref="SquadFeature"/> with its current enabled state.</param>
public sealed record SquadExport(
    Guid SquadId,
    string Name,
    bool IsPendingDeletion,
    DateTimeOffset? PurgeAt,
    IReadOnlyList<SquadExportMembership> Memberships,
    IReadOnlyList<SquadExportInvite> Invites,
    IReadOnlyList<SquadFeatureView> Features);

/// <summary>
/// A single membership as captured in a squad export (Requirement 17.2): its identity, backing user
/// (null for a guest), role (null for a guest), lifecycle state, display name, optional skill-tier
/// seed, guest flag, guest-claim-completed flag, and lawful-basis acknowledgement instant. It holds no
/// contact personally identifying information, consistent with the guest data-minimisation rule.
/// </summary>
/// <param name="MembershipId">The membership's identity.</param>
/// <param name="UserId">The backing user's identity, or <see langword="null"/> for a guest membership.</param>
/// <param name="Role">The membership's role, or <see langword="null"/> for a guest membership.</param>
/// <param name="State">The membership's lifecycle state.</param>
/// <param name="DisplayName">The membership's display name within the squad.</param>
/// <param name="SkillTier">The optional cold-start skill-tier seed, or <see langword="null"/>.</param>
/// <param name="IsGuest">Whether the membership is a guest (no backing user).</param>
/// <param name="ClaimCompleted">Whether the membership arrived via a completed guest claim.</param>
/// <param name="LawfulBasisAcknowledgedAt">The instant a lawful basis was acknowledged for a guest-origin membership, or <see langword="null"/>.</param>
public sealed record SquadExportMembership(
    Guid MembershipId,
    Guid? UserId,
    SquadRole? Role,
    MembershipState State,
    string DisplayName,
    SkillTier? SkillTier,
    bool IsGuest,
    bool ClaimCompleted,
    DateTimeOffset? LawfulBasisAcknowledgedAt);

/// <summary>
/// A single invite as captured in a squad export (Requirement 17.2): its identity, effective
/// <see cref="InviteState"/> resolved against the clock, creation audit, and expiry instant. It
/// deliberately carries <b>no</b> value from which the redeemable secret can be reconstructed — the
/// persisted one-way token hash is never exposed.
/// </summary>
/// <param name="InviteId">The invite's identity.</param>
/// <param name="State">The invite's effective state resolved against the current clock instant.</param>
/// <param name="CreatedAt">The UTC instant at which the invite was created (creation audit).</param>
/// <param name="CreatedBy">The actor that created the invite, or <see langword="null"/> for a system operation.</param>
/// <param name="ExpiresAt">The invite's expiry instant, or <see langword="null"/> for a non-expiring invite.</param>
public sealed record SquadExportInvite(
    Guid InviteId,
    InviteState State,
    DateTimeOffset CreatedAt,
    string? CreatedBy,
    DateTimeOffset? ExpiresAt);
