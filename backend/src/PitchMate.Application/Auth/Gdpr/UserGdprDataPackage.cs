using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// A comprehensive, machine-readable GDPR data-portability extract for an individual player (Article 20 UK GDPR).
/// Bundles profile identity, squad memberships and roles, match participation, stats, and recorded payment records.
/// </summary>
public sealed record UserGdprDataPackage(
    UserGdprProfile Profile,
    IReadOnlyList<UserGdprSquadMembership> Squads,
    IReadOnlyList<UserGdprMatchRecord> Matches,
    UserGdprStatsSummary Stats,
    IReadOnlyList<UserGdprPaymentRecord> Payments,
    DateTimeOffset ExportedAt);

/// <summary>Account and contact details from the user's profile.</summary>
public sealed record UserGdprProfile(
    Guid UserId,
    string DisplayName,
    string Email,
    bool EmailVerified,
    DateTimeOffset CreatedAt,
    IReadOnlyList<AuthProvider> LinkedProviders);

/// <summary>Squad membership, role, and joined date for a squad the user belongs to.</summary>
public sealed record UserGdprSquadMembership(
    Guid SquadId,
    string SquadName,
    Guid MembershipId,
    string Role,
    string State,
    string DisplayName,
    DateTimeOffset JoinedAt);

/// <summary>Participation and attendance history in a grassroots match.</summary>
public sealed record UserGdprMatchRecord(
    Guid MatchId,
    Guid SquadId,
    string SquadName,
    string MatchState,
    DateTimeOffset ScheduledDate,
    string? Team,
    string? Outcome);

/// <summary>Summary of athletic match performance.</summary>
public sealed record UserGdprStatsSummary(
    int TotalMatchesPlayed,
    int TotalWins,
    int TotalDraws,
    int TotalLosses);

/// <summary>Payment records or fee status.</summary>
public sealed record UserGdprPaymentRecord(
    string Status,
    string Description,
    DateTimeOffset? RecordedAt);
