using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// Compiles a comprehensive GDPR data export archive covering the user's profile, squads,
/// ratings, availability responses, match participation, live-tracking stats, guest claim records,
/// and notifications (Articles 15 &amp; 20 UK GDPR).
/// </summary>
public sealed class ExportUserGdprDataHandler(
    IUserRepository users,
    IAuthIdentityRepository authIdentities,
    ISquadMembershipRepository memberships,
    ISquadRepository squads,
    IMatchRepository matches,
    TimeProvider clock,
    IMembershipRatingRepository? ratings = null,
    IAvailabilityRepository? availability = null,
    IMatchEventRepository? matchEvents = null,
    IGuestClaimRepository? guestClaims = null,
    INotificationRepository? notifications = null,
    ILogger<ExportUserGdprDataHandler>? logger = null)
{
    private const int NotificationExportLimit = 1000;

    /// <summary>
    /// Produces a <see cref="UserGdprDataPackage"/> for the specified user or fails with <see cref="AuthErrorCode.UserNotFound"/>.
    /// </summary>
    public async Task<Result<UserGdprDataPackage>> HandleAsync(ExportUserGdprDataCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        User? user = await users.GetByIdAsync(command.UserId, ct);
        if (user is null)
        {
            return Result<UserGdprDataPackage>.Fail(new AuthError(
                AuthErrorCode.UserNotFound,
                "No user exists for the supplied identifier."));
        }

        IReadOnlyList<AuthIdentity> identities = await authIdentities.ListForUserAsync(command.UserId, ct);
        IReadOnlyList<AuthProvider> providers = identities.Select(i => i.Provider).Distinct().ToList();

        var profile = new UserGdprProfile(
            user.Id,
            user.DisplayName,
            user.Email,
            user.EmailVerified,
            user.CreatedAt,
            providers,
            user.AvatarReference);

        IReadOnlyList<SquadMembership> userMemberships = await memberships.ListForUserAsync(command.UserId, ct);
        var squadExports = new List<UserGdprSquadMembership>(userMemberships.Count);
        var matchExports = new List<UserGdprMatchRecord>();
        var availabilityExports = new List<UserGdprAvailabilityRecord>();

        int totalMatchesPlayed = 0;
        int wins = 0;
        int draws = 0;
        int losses = 0;
        int totalGoals = 0;
        int totalOwnGoals = 0;
        int totalCleanSheets = 0;
        int totalKeeperMinutes = 0;

        foreach (SquadMembership member in userMemberships)
        {
            Squad? squad = await squads.GetByIdIncludingDeletedAsync(member.SquadId, ct);
            string squadName = squad?.Name ?? "Squad";

            MembershipRating? rating = ratings is not null
                ? await ratings.GetAsync(member.Id, ct)
                : null;

            squadExports.Add(new UserGdprSquadMembership(
                member.SquadId,
                squadName,
                member.Id,
                member.Role?.ToString() ?? "Guest",
                member.State.ToString(),
                member.DisplayName,
                member.CreatedAt,
                member.SkillTier?.ToString(),
                member.IsGuest,
                member.LawfulBasisAcknowledgedAt,
                member.ClaimCompleted,
                squad?.IsPendingDeletion ?? false,
                rating?.Mu,
                rating?.Sigma));

            IReadOnlyList<Match> squadMatches = await matches.GetForSquadAsync(member.SquadId, ct);
            Dictionary<Guid, IReadOnlyList<MatchEvent>>? eventsByMatchId = null;
            if (matchEvents is not null)
            {
                IReadOnlyList<MatchEvent> completedEvents =
                    await matchEvents.GetForSquadCompletedMatchesAsync(member.SquadId, ct);
                eventsByMatchId = completedEvents
                    .GroupBy(e => e.MatchId)
                    .ToDictionary(g => g.Key, g => (IReadOnlyList<MatchEvent>)g.ToList());
            }

            foreach (Match match in squadMatches)
            {
                if (availability is not null)
                {
                    AvailabilityResponse? response = await availability.GetResponseAsync(match.Id, member.Id, ct);
                    if (response is not null)
                    {
                        availabilityExports.Add(new UserGdprAvailabilityRecord(
                            match.Id,
                            match.SquadId,
                            squadName,
                            response.MarkedDays.Select(d => d.Instant).Order().ToList(),
                            response.SubmittedAt));
                    }
                }

                MatchParticipant? participant = match.Participants.FirstOrDefault(p => p.SquadMembershipId == member.Id);
                if (participant is null)
                {
                    continue;
                }

                (Guid? teamId, string? teamName) = ResolveAssignedTeam(match, member.Id);
                string? outcome = null;

                bool countsAsPlayed = match.State != MatchState.Cancelled
                    && (match.State == MatchState.Completed || match.RecordedResult is not null);
                if (countsAsPlayed)
                {
                    totalMatchesPlayed++;
                    outcome = ResolveOutcome(match, teamId);
                    switch (outcome)
                    {
                        case "Win":
                            wins++;
                            break;
                        case "Draw":
                            draws++;
                            break;
                        case "Loss":
                            losses++;
                            break;
                    }
                }

                int? goalsForMatch = null;
                int? ownGoalsForMatch = null;
                int? keeperMinutesForMatch = null;

                if (match.State == MatchState.Completed
                    && eventsByMatchId is not null
                    && eventsByMatchId.TryGetValue(match.Id, out IReadOnlyList<MatchEvent>? perMatchEvents))
                {
                    MatchRichStatistics rich = MatchEventLog.ForMembership(member.Id, perMatchEvents);
                    int ownGoals = MatchEventLog.EffectiveEvents(perMatchEvents)
                        .OfType<GoalScoredEvent>()
                        .Count(g => g.OwnGoal && g.ScorerMembershipId == member.Id);

                    goalsForMatch = rich.Goals;
                    ownGoalsForMatch = ownGoals;
                    keeperMinutesForMatch = rich.KeeperMinutes;

                    totalGoals += rich.Goals;
                    totalOwnGoals += ownGoals;
                    totalKeeperMinutes += rich.KeeperMinutes;
                    if (rich.KeptAnyStint && rich.ConcededAsKeeper == 0)
                    {
                        totalCleanSheets++;
                    }
                }

                matchExports.Add(new UserGdprMatchRecord(
                    match.Id,
                    match.SquadId,
                    squadName,
                    match.State.ToString(),
                    match.ConfirmedDay?.Instant ?? match.CreatedAt,
                    teamName,
                    outcome,
                    match.Location,
                    goalsForMatch,
                    ownGoalsForMatch,
                    keeperMinutesForMatch));
            }
        }

        IReadOnlyList<UserGdprGuestClaimRecord> claimExports = [];
        if (guestClaims is not null)
        {
            IReadOnlyList<GuestClaim> userClaims = await guestClaims.ListForUserAsync(command.UserId, ct);
            claimExports = userClaims
                .Select(c => new UserGdprGuestClaimRecord(
                    c.Id,
                    c.MembershipId,
                    c.State.ToString(),
                    c.ConsentAt,
                    c.CompletedAt,
                    c.ReversedAt,
                    c.CancelledAt))
                .ToList();
        }

        IReadOnlyList<UserGdprNotificationRecord> notificationExports = [];
        if (notifications is not null)
        {
            IReadOnlyList<InAppNotification> userNotifications =
                await notifications.ListForUserAsync(command.UserId, squadId: null, NotificationExportLimit, ct);
            notificationExports = userNotifications
                .Select(n => new UserGdprNotificationRecord(
                    n.Id,
                    n.SquadId,
                    n.RecipientMembershipId,
                    n.Type.ToString(),
                    n.Title,
                    n.Body,
                    n.ReadState.ToString(),
                    n.CreatedAt))
                .ToList();
        }

        var stats = new UserGdprStatsSummary(
            totalMatchesPlayed,
            wins,
            draws,
            losses,
            totalGoals,
            totalOwnGoals,
            totalCleanSheets,
            totalKeeperMinutes);
        var payments = new List<UserGdprPaymentRecord>();

        var exportPackage = new UserGdprDataPackage(
            profile,
            squadExports,
            matchExports,
            stats,
            payments,
            clock.GetUtcNow(),
            availabilityExports,
            claimExports,
            notificationExports);

        logger?.LogInformation("User GDPR data export package generated (Article 20 Data Portability). UserId={UserId}", command.UserId);

        return Result<UserGdprDataPackage>.Ok(exportPackage);
    }

    private static (Guid? TeamId, string? TeamName) ResolveAssignedTeam(Match match, Guid membershipId)
    {
        if (match.KickoffLineup is not null)
        {
            KickoffTeam? kickoffTeam = match.KickoffLineup.Teams
                .FirstOrDefault(t => t.ParticipantMembershipIds.Contains(membershipId));
            if (kickoffTeam is not null)
            {
                return (kickoffTeam.TeamId, kickoffTeam.TeamName);
            }
        }

        MatchTeam? workingTeam = match.Teams.FirstOrDefault(t => t.Roster.Contains(membershipId));
        return workingTeam is not null ? (workingTeam.Id, workingTeam.TeamName) : (null, null);
    }

    private static string? ResolveOutcome(Match match, Guid? teamId)
    {
        if (!teamId.HasValue || match.RecordedResult is null || match.RecordedResult.TeamScores.Count < 2)
        {
            return null;
        }

        TeamScore? myScore = null;
        int maxOtherScore = int.MinValue;
        bool hasOtherScore = false;

        foreach (TeamScore score in match.RecordedResult.TeamScores)
        {
            if (score.TeamId == teamId.Value)
            {
                myScore = score;
            }
            else
            {
                hasOtherScore = true;
                if (score.Score > maxOtherScore)
                {
                    maxOtherScore = score.Score;
                }
            }
        }

        if (!myScore.HasValue || !hasOtherScore)
        {
            return null;
        }

        if (myScore.Value.Score > maxOtherScore)
        {
            return "Win";
        }

        return myScore.Value.Score < maxOtherScore ? "Loss" : "Draw";
    }
}
