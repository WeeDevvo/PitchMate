using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// Machine-readable comprehensive data export package complying with UK GDPR Articles 15 &amp; 20
/// (Right of Access &amp; Right to Data Portability).
/// </summary>
public sealed record UserGdprDataPackage(
    UserGdprProfile Profile,
    IReadOnlyList<UserGdprSquadMembership> Squads,
    IReadOnlyList<UserGdprMatchRecord> Matches,
    UserGdprStatsSummary Stats,
    IReadOnlyList<UserGdprPaymentRecord> Payments,
    DateTimeOffset ExportedAt,
    IReadOnlyList<UserGdprAvailabilityRecord> AvailabilityResponses,
    IReadOnlyList<UserGdprGuestClaimRecord> GuestClaims,
    IReadOnlyList<UserGdprNotificationRecord> Notifications);

/// <summary>Core user profile details in GDPR export.</summary>
public sealed record UserGdprProfile(
    Guid UserId,
    string DisplayName,
    string Email,
    bool EmailVerified,
    DateTimeOffset CreatedAt,
    IReadOnlyList<AuthProvider> LinkedProviders,
    string? AvatarReference = null);

/// <summary>Squad membership summary in GDPR export.</summary>
public sealed record UserGdprSquadMembership(
    Guid SquadId,
    string SquadName,
    Guid MembershipId,
    string Role,
    string State,
    string DisplayName,
    DateTimeOffset JoinedAt,
    string? SkillTier = null,
    bool IsGuest = false,
    DateTimeOffset? LawfulBasisAcknowledgedAt = null,
    bool ClaimCompleted = false,
    bool SquadPendingDeletion = false,
    double? RatingMu = null,
    double? RatingSigma = null);

/// <summary>Match participation record in GDPR export.</summary>
public sealed record UserGdprMatchRecord(
    Guid MatchId,
    Guid SquadId,
    string SquadName,
    string Status,
    DateTimeOffset? MatchDate,
    string? TeamName,
    string? Outcome,
    string? Location = null,
    int? GoalsScored = null,
    int? OwnGoals = null,
    int? KeeperMinutes = null);

/// <summary>Aggregated athletic performance stats summary in GDPR export.</summary>
public sealed record UserGdprStatsSummary(
    int TotalMatchesPlayed,
    int Wins,
    int Draws,
    int Losses,
    int GoalsScored = 0,
    int OwnGoals = 0,
    int CleanSheets = 0,
    int KeeperMinutes = 0);

/// <summary>Payment history record in GDPR export (currently unused; PitchMate does not process payments).</summary>
public sealed record UserGdprPaymentRecord(
    Guid PaymentId,
    string Description,
    decimal Amount,
    string Currency,
    DateTimeOffset Date);

/// <summary>Match availability submission in GDPR export.</summary>
public sealed record UserGdprAvailabilityRecord(
    Guid MatchId,
    Guid SquadId,
    string SquadName,
    IReadOnlyList<DateTimeOffset> MarkedDays,
    DateTimeOffset SubmittedAt);

/// <summary>Guest claim consent or completion audit record targeting the exported user.</summary>
public sealed record UserGdprGuestClaimRecord(
    Guid ClaimId,
    Guid MembershipId,
    string State,
    DateTimeOffset? ConsentAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? ReversedAt,
    DateTimeOffset? CancelledAt);

/// <summary>In-app notification addressed to the exported user.</summary>
public sealed record UserGdprNotificationRecord(
    Guid NotificationId,
    Guid SquadId,
    Guid RecipientMembershipId,
    string Type,
    string Title,
    string Body,
    string ReadState,
    DateTimeOffset CreatedAt);
