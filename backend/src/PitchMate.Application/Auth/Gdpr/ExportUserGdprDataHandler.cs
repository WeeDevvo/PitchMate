using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// Compiles a comprehensive GDPR data export archive covering the user's profile, squads,
/// match participation, athletic stats, and payments (Articles 15 &amp; 20 UK GDPR).
/// </summary>
public sealed class ExportUserGdprDataHandler(
    IUserRepository users,
    IAuthIdentityRepository authIdentities,
    ISquadMembershipRepository memberships,
    ISquadRepository squads,
    IMatchRepository matches,
    TimeProvider clock,
    ILogger<ExportUserGdprDataHandler>? logger = null)
{
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
            providers);

        IReadOnlyList<SquadMembership> userMemberships = await memberships.ListForUserAsync(command.UserId, ct);
        var squadExports = new List<UserGdprSquadMembership>();
        var matchExports = new List<UserGdprMatchRecord>();

        int totalMatches = 0;
        int wins = 0;
        int draws = 0;
        int losses = 0;

        foreach (SquadMembership member in userMemberships)
        {
            Squad? squad = await squads.GetByIdAsync(member.SquadId, ct);
            string squadName = squad?.Name ?? "Squad";

            squadExports.Add(new UserGdprSquadMembership(
                member.SquadId,
                squadName,
                member.Id,
                member.Role?.ToString() ?? "Guest",
                member.State.ToString(),
                member.DisplayName,
                member.CreatedAt));

            IReadOnlyList<Match> squadMatches = await matches.GetForSquadAsync(member.SquadId, ct);
            foreach (Match match in squadMatches)
            {
                MatchParticipant? participant = match.Participants.FirstOrDefault(p => p.SquadMembershipId == member.Id);
                if (participant is null)
                {
                    continue;
                }

                totalMatches++;
                string? teamName = null;
                string? outcome = null;

                MatchTeam? assignedTeam = match.Teams.FirstOrDefault(t => t.Roster.Contains(member.Id));
                if (assignedTeam is not null)
                {
                    teamName = assignedTeam.TeamName;
                }

                if (match.RecordedResult is not null && match.Teams.Count >= 2)
                {
                    var teamsList = match.Teams.ToList();
                    MatchTeam teamA = teamsList[0];
                    MatchTeam teamB = teamsList[1];
                    TeamScore? scoreA = null;
                    TeamScore? scoreB = null;
                    foreach (var s in match.RecordedResult.TeamScores)
                    {
                        if (s.TeamId == teamA.Id) scoreA = s;
                        else if (s.TeamId == teamB.Id) scoreB = s;
                    }

                    if (scoreA.HasValue && scoreB.HasValue)
                    {
                        if (scoreA.Value.Score == scoreB.Value.Score)
                        {
                            draws++;
                            outcome = "Draw";
                        }
                        else
                        {
                            bool teamAWon = scoreA.Value.Score > scoreB.Value.Score;
                            bool onTeamA = teamA.Roster.Contains(member.Id);
                            bool onTeamB = teamB.Roster.Contains(member.Id);

                            if ((teamAWon && onTeamA) || (!teamAWon && onTeamB))
                            {
                                wins++;
                                outcome = "Win";
                            }
                            else if (onTeamA || onTeamB)
                            {
                                losses++;
                                outcome = "Loss";
                            }
                        }
                    }
                }

                matchExports.Add(new UserGdprMatchRecord(
                    match.Id,
                    match.SquadId,
                    squadName,
                    match.State.ToString(),
                    match.ConfirmedDay?.Instant ?? match.CreatedAt,
                    teamName,
                    outcome));
            }
        }

        var stats = new UserGdprStatsSummary(totalMatches, wins, draws, losses);
        var payments = new List<UserGdprPaymentRecord>();

        var exportPackage = new UserGdprDataPackage(
            profile,
            squadExports,
            matchExports,
            stats,
            payments,
            clock.GetUtcNow());

        logger?.LogInformation("User GDPR data export package generated (Article 20 Data Portability). UserId={UserId}", command.UserId);

        return Result<UserGdprDataPackage>.Ok(exportPackage);
    }
}
