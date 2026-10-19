using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Persistence.Configurations.Matches;

namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// The <see cref="IMatchDetailSource"/> over the normalised match tables (match-read-models
/// Requirement 2.12): one statement, whatever the participant and candidate-day counts.
/// <para>
/// <b>Visibility.</b> The match is <i>inner</i>-joined to a squad that is not soft-deleted, so a match
/// in a squad inside its deletion grace period yields no row and the read reports it exactly as an
/// absent or soft-deleted match (Requirement 5.10). Every joined table carries its own explicit
/// <c>NOT is_deleted</c>, because the model's query filters apply to LINQ and not to raw SQL.
/// </para>
/// <para>
/// <b>Participants.</b> The participant and membership tables are <i>left</i>-joined, so a match with
/// no participants still returns its header, and the rows are ordered by roster position in the
/// database, which makes the pool's total order the database's (Requirement 2.4).
/// </para>
/// <para>
/// <b>Display names</b> are resolved in SQL as the exact form of
/// <see cref="ParticipantDisplayName.Resolve"/>: the placeholder when the membership row is absent,
/// when it is anonymised (<c>display_name_normalized IS NULL</c>), or when the captured name is blank;
/// the captured name otherwise. The placeholder is bound from
/// <see cref="SquadMembership.DisplayNamePlaceholder"/>, never typed into the statement.
/// </para>
/// </summary>
internal sealed class EfMatchDetailSource(PitchMateDbContext db) : IMatchDetailSource
{
    /// <inheritdoc />
    public async Task<MatchDetailProjection?> FindAsync(Guid matchId, CancellationToken cancellationToken)
    {
        // One statement. {0} binds the match identity and {1} the display-name placeholder.
        List<MatchDetailRow> rows = await db.Database
            .SqlQueryRaw<MatchDetailRow>(BuildSql(db.Model), matchId, SquadMembership.DisplayNamePlaceholder)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return null;
        }

        MatchDetailRow header = rows[0];
        MatchState state = ToMatchState(header.State);

        List<ParticipantView> participants =
        [
            .. rows
                .Where(static row => row.ParticipantMembershipId is not null)
                .Select(static row => new ParticipantView(
                    row.ParticipantMembershipId!.Value,
                    row.ParticipantDisplayName ?? SquadMembership.DisplayNamePlaceholder,
                    row.ParticipantIsGuest ?? false,
                    row.ParticipantRosterPosition ?? 0)),
        ];

        RecordedResultView? recordedResult = header.RecordedResultJson is not null
            ? ToRecordedResultView(MatchValueObjectJson.DeserializeResult(header.RecordedResultJson))
            : null;

        return new MatchDetailProjection(
            header.MatchId,
            header.SquadId,
            state,
            header.Location,
            [.. MatchValueObjectJson.DeserializeCandidateDays(header.CandidateDaysJson).Select(static day => day.Instant)],
            header.ConfirmedDay,
            participants,
            recordedResult,
            state == MatchState.Completed ? header.CompletedAt : null);
    }

    private static RecordedResultView ToRecordedResultView(MatchResult result) =>
        new(result.Fidelity, [.. result.TeamScores]);

    private static MatchState ToMatchState(int value) =>
        Enum.IsDefined(typeof(MatchState), value)
            ? (MatchState)value
            : throw new InvalidOperationException(
                $"A match row carried the lifecycle state value '{value}', which is not a defined {nameof(MatchState)}.");

    /// <summary>Builds the statement, reading every table and column name from the EF model.</summary>
    private static string BuildSql(IModel model)
    {
        MappedTable match = MappedTable.For(model, typeof(Match));
        MappedTable squad = MappedTable.For(model, typeof(Squad));
        MappedTable participant = MappedTable.For(model, typeof(MatchParticipant));
        MappedTable membership = MappedTable.For(model, typeof(SquadMembership));

        return
            $$$"""
            SELECT  m."{{{match.Column(nameof(Match.Id))}}}"                    AS match_id,
                    m."{{{match.Column(nameof(Match.SquadId))}}}"               AS squad_id,
                    m."{{{match.Column(nameof(Match.State))}}}"                 AS state,
                    m."{{{match.Column(nameof(Match.Location))}}}"              AS location,
                    m."{{{match.Column(nameof(Match.ConfirmedDay))}}}"          AS confirmed_day,
                    m."{{{match.Column(nameof(Match.CompletedAt))}}}"           AS completed_at,
                    m."{{{match.Column(nameof(Match.CandidateDays))}}}"::text   AS candidate_days_json,
                    m."{{{match.Column(nameof(Match.RecordedResult))}}}"::text  AS recorded_result_json,
                    p."{{{participant.Column(nameof(MatchParticipant.SquadMembershipId))}}}" AS participant_membership_id,
                    p."{{{participant.Column(nameof(MatchParticipant.IsGuest))}}}"           AS participant_is_guest,
                    p."{{{participant.Column(nameof(MatchParticipant.RosterPosition))}}}"    AS participant_roster_position,
                    CASE
                        WHEN p."{{{participant.Column(nameof(MatchParticipant.SquadMembershipId))}}}" IS NULL THEN NULL
                        WHEN sm."{{{membership.Column(nameof(SquadMembership.Id))}}}" IS NULL
                          OR sm."{{{membership.Column(nameof(SquadMembership.DisplayNameNormalized))}}}" IS NULL
                          OR p."{{{participant.Column(nameof(MatchParticipant.DisplayName))}}}" IS NULL
                          OR p."{{{participant.Column(nameof(MatchParticipant.DisplayName))}}}" ~ '^\s*$'
                            THEN {1}
                        ELSE p."{{{participant.Column(nameof(MatchParticipant.DisplayName))}}}"
                    END AS participant_display_name
            FROM    "{{{match.Table}}}" AS m
            JOIN    "{{{squad.Table}}}" AS s
                    ON  s."{{{squad.Column(nameof(Squad.Id))}}}" = m."{{{match.Column(nameof(Match.SquadId))}}}"
                    AND NOT s."{{{squad.Column(nameof(Squad.IsDeleted))}}}"
            LEFT JOIN "{{{participant.Table}}}" AS p
                    ON  p."{{{participant.Column(nameof(MatchParticipant.MatchId))}}}" = m."{{{match.Column(nameof(Match.Id))}}}"
                    AND NOT p."{{{participant.Column(nameof(MatchParticipant.IsDeleted))}}}"
            LEFT JOIN "{{{membership.Table}}}" AS sm
                    ON  sm."{{{membership.Column(nameof(SquadMembership.Id))}}}" = p."{{{participant.Column(nameof(MatchParticipant.SquadMembershipId))}}}"
                    AND NOT sm."{{{membership.Column(nameof(SquadMembership.IsDeleted))}}}"
            WHERE   m."{{{match.Column(nameof(Match.Id))}}}" = {0}
              AND   NOT m."{{{match.Column(nameof(Match.IsDeleted))}}}"
            ORDER BY p."{{{participant.Column(nameof(MatchParticipant.RosterPosition))}}}" NULLS LAST
            """;
    }
}
