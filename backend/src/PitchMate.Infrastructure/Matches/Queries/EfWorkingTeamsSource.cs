using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// The <see cref="IWorkingTeamsSource"/> over the normalised match tables (match-read-models
/// Requirement 4.18): <b>three statements</b>, a fixed count whatever the team and participant counts.
/// <list type="number">
///   <item><description>The match header, inner-joined to a visible squad, with its teams left-joined
///   in creation order and each roster read as the <c>uuid[]</c> column it is — in stored order, so a
///   moved participant stays last.</description></item>
///   <item><description>The match's participants in roster-position order, with display names resolved
///   by the SQL form of <see cref="ParticipantDisplayName.Resolve"/>. The membership join is
///   <b>scoped to the match's squad</b>, so a participant row naming another squad's membership resolves
///   to the placeholder rather than leaking that membership's name.</description></item>
///   <item><description>The participating members' skill tiers and persisted ratings, again scoped to
///   the match's squad.</description></item>
/// </list>
/// <para>
/// Names and bib flags are reported exactly as stored (Requirement 4.5). A rostered identity with no
/// participant row resolves to the placeholder and is neither omitted nor allowed to fail the read
/// (Requirement 4.7). Every joined table carries its own <c>NOT is_deleted</c>, and table and column
/// names are read from the EF model.
/// </para>
/// </summary>
internal sealed class EfWorkingTeamsSource(PitchMateDbContext db) : IWorkingTeamsSource
{
    /// <inheritdoc />
    public async Task<WorkingTeamsProjection?> FindAsync(Guid matchId, CancellationToken cancellationToken)
    {
        Sql sql = Sql.For(db.Model);

        List<WorkingTeamRow> teamRows = await db.Database
            .SqlQueryRaw<WorkingTeamRow>(sql.Teams, matchId)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        if (teamRows.Count == 0)
        {
            return null;
        }

        Guid squadId = teamRows[0].SquadId;

        List<WorkingTeamsParticipantRow> participants = await db.Database
            .SqlQueryRaw<WorkingTeamsParticipantRow>(sql.Participants, matchId, squadId, SquadMembership.DisplayNamePlaceholder)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        List<WorkingTeamsRatingRow> ratings = await db.Database
            .SqlQueryRaw<WorkingTeamsRatingRow>(sql.Ratings, matchId, squadId)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        Dictionary<Guid, string> namesById = participants.ToDictionary(
            static participant => participant.SquadMembershipId,
            static participant => participant.DisplayName);

        List<WorkingTeamView> teams =
        [
            .. teamRows
                .Where(static row => row.TeamId is not null)
                .Select(row => new WorkingTeamView(
                    row.TeamId!.Value,
                    row.TeamName ?? string.Empty,
                    row.BibFlag ?? false,
                    [
                        .. (row.Roster ?? []).Select(id => new RosterEntry(
                            id,
                            namesById.TryGetValue(id, out string? name) ? name : SquadMembership.DisplayNamePlaceholder)),
                    ])),
        ];

        return new WorkingTeamsProjection(
            matchId,
            squadId,
            teams,
            [.. participants.Select(static participant => participant.SquadMembershipId)],
            ratings
                .Where(static row => row.Mu is not null && row.Sigma is not null)
                .ToDictionary(static row => row.SquadMembershipId, static row => new PlayerRating(row.Mu!.Value, row.Sigma!.Value)),
            ratings.ToDictionary(static row => row.SquadMembershipId, static row => (SkillTier?)row.SkillTier));
    }

    /// <summary>The three statements, every table and column name read from the EF model.</summary>
    private sealed record Sql(string Teams, string Participants, string Ratings)
    {
        public static Sql For(IModel model)
        {
            MappedTable match = MappedTable.For(model, typeof(Match));
            MappedTable squad = MappedTable.For(model, typeof(Squad));
            MappedTable team = MappedTable.For(model, typeof(MatchTeam));
            MappedTable participant = MappedTable.For(model, typeof(MatchParticipant));
            MappedTable membership = MappedTable.For(model, typeof(SquadMembership));
            MappedTable rating = MappedTable.For(model, typeof(MembershipRating));

            string pMembership = participant.Column(nameof(MatchParticipant.SquadMembershipId));
            string pMatch = participant.Column(nameof(MatchParticipant.MatchId));
            string pDeleted = participant.Column(nameof(MatchParticipant.IsDeleted));
            string pName = participant.Column(nameof(MatchParticipant.DisplayName));
            string smKey = membership.Column(nameof(SquadMembership.Id));
            string smSquad = membership.Column(nameof(SquadMembership.SquadId));
            string smDeleted = membership.Column(nameof(SquadMembership.IsDeleted));

            // {0} the match identity.
            string teams =
                $$$"""
                SELECT  m."{{{match.Column(nameof(Match.Id))}}}"       AS match_id,
                        m."{{{match.Column(nameof(Match.SquadId))}}}"  AS squad_id,
                        t."{{{team.Column(nameof(MatchTeam.Id))}}}"       AS team_id,
                        t."{{{team.Column(nameof(MatchTeam.TeamName))}}}" AS team_name,
                        t."{{{team.Column(nameof(MatchTeam.BibFlag))}}}"  AS bib_flag,
                        t."{{{team.Column(nameof(MatchTeam.Roster))}}}"   AS roster
                FROM    "{{{match.Table}}}" AS m
                JOIN    "{{{squad.Table}}}" AS s
                        ON  s."{{{squad.Column(nameof(Squad.Id))}}}" = m."{{{match.Column(nameof(Match.SquadId))}}}"
                        AND NOT s."{{{squad.Column(nameof(Squad.IsDeleted))}}}"
                LEFT JOIN "{{{team.Table}}}" AS t
                        ON  t."{{{team.Column(nameof(MatchTeam.MatchId))}}}" = m."{{{match.Column(nameof(Match.Id))}}}"
                        AND NOT t."{{{team.Column(nameof(MatchTeam.IsDeleted))}}}"
                WHERE   m."{{{match.Column(nameof(Match.Id))}}}" = {0}
                  AND   NOT m."{{{match.Column(nameof(Match.IsDeleted))}}}"
                ORDER BY t."{{{team.Column(nameof(MatchTeam.Id))}}}"
                """;

            // {0} the match, {1} its squad, {2} the display-name placeholder.
            string participants =
                $$$"""
                SELECT  p."{{{pMembership}}}" AS squad_membership_id,
                        CASE
                            WHEN sm."{{{smKey}}}" IS NULL
                              OR sm."{{{membership.Column(nameof(SquadMembership.DisplayNameNormalized))}}}" IS NULL
                              OR p."{{{pName}}}" IS NULL
                              OR p."{{{pName}}}" ~ '^\s*$'
                                THEN {2}
                            ELSE p."{{{pName}}}"
                        END AS display_name
                FROM    "{{{participant.Table}}}" AS p
                LEFT JOIN "{{{membership.Table}}}" AS sm
                        ON  sm."{{{smKey}}}" = p."{{{pMembership}}}"
                        AND sm."{{{smSquad}}}" = {1}
                        AND NOT sm."{{{smDeleted}}}"
                WHERE   p."{{{pMatch}}}" = {0}
                  AND   NOT p."{{{pDeleted}}}"
                ORDER BY p."{{{participant.Column(nameof(MatchParticipant.RosterPosition))}}}"
                """;

            // {0} the match, {1} its squad.
            string ratings =
                $$$"""
                SELECT  sm."{{{smKey}}}" AS squad_membership_id,
                        sm."{{{membership.Column(nameof(SquadMembership.SkillTier))}}}" AS skill_tier,
                        r."{{{rating.Column(nameof(MembershipRating.Mu))}}}"    AS mu,
                        r."{{{rating.Column(nameof(MembershipRating.Sigma))}}}" AS sigma
                FROM    "{{{membership.Table}}}" AS sm
                LEFT JOIN "{{{rating.Table}}}" AS r
                        ON  r."{{{rating.Column(nameof(MembershipRating.SquadMembershipId))}}}" = sm."{{{smKey}}}"
                        AND NOT r."{{{rating.Column(nameof(MembershipRating.IsDeleted))}}}"
                WHERE   sm."{{{smSquad}}}" = {1}
                  AND   NOT sm."{{{smDeleted}}}"
                  AND   sm."{{{smKey}}}" IN (
                            SELECT p."{{{pMembership}}}"
                            FROM   "{{{participant.Table}}}" AS p
                            WHERE  p."{{{pMatch}}}" = {0}
                              AND  NOT p."{{{pDeleted}}}")
                """;

            return new Sql(teams, participants, ratings);
        }
    }
}
