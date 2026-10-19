using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// The <see cref="IRosterDisplayNameSource"/> over the normalised tables (match-read-models
/// Requirement 10.7): one statement — the match's participants left-joined to their memberships, the
/// join scoped to the match's squad — resolving each name with the same SQL <c>CASE</c> form of
/// <see cref="ParticipantDisplayName.Resolve"/> the other reads use, the placeholder bound from
/// <see cref="SquadMembership.DisplayNamePlaceholder"/>.
/// </summary>
internal sealed class EfRosterDisplayNameSource(PitchMateDbContext db) : IRosterDisplayNameSource
{
    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<Guid, string>> ListForMatchAsync(Guid matchId, CancellationToken cancellationToken)
    {
        List<WorkingTeamsParticipantRow> rows = await db.Database
            .SqlQueryRaw<WorkingTeamsParticipantRow>(BuildSql(db.Model), matchId, SquadMembership.DisplayNamePlaceholder)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return rows.ToDictionary(static row => row.SquadMembershipId, static row => row.DisplayName);
    }

    /// <summary>Builds the statement, reading every table and column name from the EF model.</summary>
    private static string BuildSql(IModel model)
    {
        MappedTable match = MappedTable.For(model, typeof(Match));
        MappedTable participant = MappedTable.For(model, typeof(MatchParticipant));
        MappedTable membership = MappedTable.For(model, typeof(SquadMembership));

        string pName = participant.Column(nameof(MatchParticipant.DisplayName));
        string pMembership = participant.Column(nameof(MatchParticipant.SquadMembershipId));
        string smKey = membership.Column(nameof(SquadMembership.Id));

        // {0} the match identity, {1} the display-name placeholder.
        return
            $$$"""
            SELECT  p."{{{pMembership}}}" AS squad_membership_id,
                    CASE
                        WHEN sm."{{{smKey}}}" IS NULL
                          OR sm."{{{membership.Column(nameof(SquadMembership.DisplayNameNormalized))}}}" IS NULL
                          OR p."{{{pName}}}" IS NULL
                          OR p."{{{pName}}}" ~ '^\s*$'
                            THEN {1}
                        ELSE p."{{{pName}}}"
                    END AS display_name
            FROM    "{{{participant.Table}}}" AS p
            JOIN    "{{{match.Table}}}" AS m
                    ON  m."{{{match.Column(nameof(Match.Id))}}}" = p."{{{participant.Column(nameof(MatchParticipant.MatchId))}}}"
            LEFT JOIN "{{{membership.Table}}}" AS sm
                    ON  sm."{{{smKey}}}" = p."{{{pMembership}}}"
                    AND sm."{{{membership.Column(nameof(SquadMembership.SquadId))}}}" = m."{{{match.Column(nameof(Match.SquadId))}}}"
                    AND NOT sm."{{{membership.Column(nameof(SquadMembership.IsDeleted))}}}"
            WHERE   p."{{{participant.Column(nameof(MatchParticipant.MatchId))}}}" = {0}
              AND   NOT p."{{{participant.Column(nameof(MatchParticipant.IsDeleted))}}}"
            """;
    }
}
