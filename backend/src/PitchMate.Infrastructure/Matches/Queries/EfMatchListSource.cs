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
/// EF Core implementation of <see cref="IMatchListSource"/> over the shared
/// <see cref="PitchMateDbContext"/>, composing a squad's match list from the existing normalised
/// match tables in <b>one statement</b> and reading no denormalised summary table
/// (Requirement 1.12). It is <see langword="internal"/> and registered from
/// <c>AddMatchesInfrastructure</c> inside this assembly, so no Application or Api type can name it
/// (Requirement 11.2).
/// <para>
/// <b>Why raw SQL rather than LINQ.</b> The ordering key of Requirement 1.9 is a match's confirmed
/// day where it has one and otherwise the <em>earliest of its candidate days</em> — and the candidate
/// days are a <c>jsonb</c> array, so the key is a per-row minimum over a lateral unnest that EF cannot
/// translate. Evaluating it in memory would mean reading a squad's whole match history to answer a
/// 200-row page, which Requirement 1.12 forbids. The statement is therefore built here, with
/// <b>positional parameters</b> for the squad identity and the limit — never string interpolation of
/// caller input.
/// </para>
/// <para>
/// <b>Squad visibility is the outer <c>WHERE</c>.</b> Zero rows means the squad is absent or
/// soft-deleted, and the source returns <see langword="null"/> so the handler conceals
/// (Requirement 5.9). This explicit join is load-bearing rather than decorative: a squad's
/// soft-delete does <b>not</b> cascade to its <see cref="SquadMembership"/> rows, so resolving a
/// membership and gating on it would happily admit a squad that is inside its deletion grace period.
/// Every new squad-scoped read needs the join.
/// </para>
/// <para>
/// <b><c>LEFT JOIN LATERAL … ON TRUE</c> is what separates the two empty cases</b> without a second
/// query: a visible squad with no admitted match yields exactly one row whose match identity is null,
/// which this source reports as an <b>empty page</b>, while a squad that is not visible yields zero
/// rows (Requirement 1.11).
/// </para>
/// <para>
/// <b><c>LIMIT {limit} + 1</c> is the truncation signal.</b> The statement admits one row more than
/// the caller asked for; the source returns the first <c>limit</c> entries and reports
/// <see cref="MatchListPage.Truncated"/> as "the admitted count exceeded the limit". No
/// <c>COUNT(*)</c>, no second round trip (Requirement 1.10, 1.13).
/// </para>
/// <para>
/// <b>Ordering.</b> <c>ORDER BY scheduling_instant DESC NULLS LAST, id DESC</c>. The <c>NULLS LAST</c>
/// is defensive rather than required — every match carries 1 to 14 candidate days because
/// <see cref="Match.CreateDraft"/> enforces it, so the key is never null — but the database does not
/// enforce that invariant, and under <c>DESC</c> a null would otherwise sort <em>first</em> and
/// corrupt the top of the list. The <c>id DESC</c> tie-break is the same total order as the Domain
/// comparator <see cref="MatchSchedulingOrder"/>, because PostgreSQL orders <c>uuid</c> in canonical
/// big-endian byte order, which for GUID v7 is creation order — the reasoning
/// <c>EfMatchRepository.ListChronologicalCompletedForSquadAsync</c> already relies on.
/// </para>
/// <para>
/// <b>Soft-delete.</b> The global <c>HasQueryFilter</c> applies to LINQ only, so the filter is
/// replicated explicitly as <c>NOT is_deleted</c> on every table the statement joins.
/// </para>
/// <para>
/// <b>Mapping.</b> Table and column names are read from the EF model
/// (<see cref="IEntityType.GetTableName()"/> / <c>GetColumnName</c>) following
/// <c>MembershipStandingScopeHarness</c>'s precedent, so a mapping change moves the SQL with it
/// rather than breaking it silently. The names are singular — <c>match</c>,
/// <c>match_participant</c>, <c>squad</c> — because <c>EFCore.NamingConventions</c> snake-cases the
/// EF-conventional names and does not pluralise.
/// </para>
/// <para>
/// <b>No index, no migration.</b> The ordering key is not indexable: PostgreSQL rejects a subquery in
/// both an index expression and a <c>GENERATED … STORED</c> expression, and the earliest element of
/// an unsorted <c>jsonb</c> array is obtainable only by subquery. The plan is an index scan on the
/// existing <c>ix_match_squad_id</c>, a per-row minimum over 1 to 14 elements, a sort and a
/// <c>LIMIT 201</c>.
/// </para>
/// <para>
/// <b>No tracking, no mutation.</b> The query is <see cref="EntityFrameworkQueryableExtensions.AsNoTracking{TEntity}"/>
/// and no entity is loaded for mutation, so nothing enters the change tracker and no
/// <c>SaveChanges</c> can stamp an <c>updated_at</c> (Requirement 1.14).
/// </para>
/// <para>Validates: Requirements 1.9, 1.10, 1.12, 1.13, 5.9, 11.2, 11.6, 11.7.</para>
/// </summary>
internal sealed class EfMatchListSource(PitchMateDbContext db) : IMatchListSource
{
    /// <inheritdoc />
    public async Task<MatchListPage?> ListForSquadAsync(
        Guid squadId,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(limit);

        // One statement. {0} binds the squad identity and {1} the limit as EF positional parameters.
        List<MatchListRow> rows = await db.Database
            .SqlQueryRaw<MatchListRow>(BuildSql(db.Model), squadId, limit)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        // Zero rows: the outer WHERE rejected the squad, so it is absent or inside its deletion grace
        // period. Report "not visible" rather than "visible and empty" (Requirement 5.9).
        if (rows.Count == 0)
        {
            return null;
        }

        // A visible squad with no admitted match arrives as the single lateral placeholder row, whose
        // match identity is null; it projects to zero entries, not to a concealment (Requirement 1.11).
        var entries = new List<MatchListEntry>(Math.Min(rows.Count, limit));
        var admitted = 0;

        foreach (MatchListRow row in rows)
        {
            if (row.MatchId is null)
            {
                continue;
            }

            admitted++;
            if (entries.Count < limit)
            {
                entries.Add(Project(row));
            }
        }

        // The extra admitted row *is* the truncation signal (Requirement 1.10).
        return new MatchListPage(entries, admitted > limit);
    }

    /// <summary>
    /// Projects one admitted row onto a <see cref="MatchListEntry"/>, rehydrating the three
    /// <c>jsonb</c> documents through the <em>same</em> <see cref="MatchValueObjectJson"/>
    /// deserialisers the entity configuration's value converters use, so the raw-SQL read path and the
    /// mapped write path cannot drift.
    /// </summary>
    private static MatchListEntry Project(MatchListRow row)
    {
        MatchState state = ToMatchState(row.State);

        // Candidate days are carried only while gathering availability; every other state carries an
        // empty collection rather than omitting the member (Requirement 1.5, 1.8).
        IReadOnlyList<DateTimeOffset> candidateDays =
            state == MatchState.GatheringAvailability && row.CandidateDaysJson is not null
                ? MatchValueObjectJson.DeserializeCandidateDays(row.CandidateDaysJson)
                    .Select(day => day.Instant)
                    .ToList()
                : [];

        // Locked team names and bib flags in locked-team order, and nothing else — no roster, no
        // RosterEntry, no squad-membership identity, so a list row discloses no lineup
        // (Requirement 1.7). A match that has locked no lineup carries an empty collection.
        IReadOnlyList<LockedTeamSummary> lockedTeams = row.KickoffLineupJson is not null
            ? MatchValueObjectJson.DeserializeLineup(row.KickoffLineupJson).Teams
                .Select(team => new LockedTeamSummary(team.TeamName, team.BibFlag))
                .ToList()
            : [];

        // The recorded result and the completion instant are carried only when the match is completed
        // (Requirement 1.6); absent, they are explicit nulls (Requirement 1.8).
        var completed = state == MatchState.Completed;

        RecordedResultView? recordedResult = completed && row.RecordedResultJson is not null
            ? ToRecordedResultView(MatchValueObjectJson.DeserializeResult(row.RecordedResultJson))
            : null;

        return new MatchListEntry(
            row.MatchId!.Value,
            state,
            row.Location ?? string.Empty,
            // Null while gathering availability by the aggregate's own invariant — it is set only by a
            // successful Confirm, which leaves that state (Requirement 1.5).
            row.ConfirmedDay,
            candidateDays,
            row.ParticipantCount ?? 0,
            lockedTeams,
            recordedResult,
            completed ? row.CompletedAt : null);
    }

    /// <summary>
    /// Maps a recorded <see cref="MatchResult"/> onto the wire view, carrying the fidelity and the
    /// per-team scores and nothing else.
    /// </summary>
    private static RecordedResultView ToRecordedResultView(MatchResult result) =>
        new(result.Fidelity, [.. result.TeamScores]);

    /// <summary>
    /// Converts the <c>state</c> column's stable numeric value to a <see cref="MatchState"/>, refusing
    /// a value the enum does not define rather than letting an undefined state reach the wire.
    /// </summary>
    private static MatchState ToMatchState(int? value)
    {
        if (value is null || !Enum.IsDefined(typeof(MatchState), value.Value))
        {
            throw new InvalidOperationException(
                $"A match row carried the lifecycle state value '{value?.ToString() ?? "null"}', which is not a defined {nameof(MatchState)}.");
        }

        return (MatchState)value.Value;
    }

    /// <summary>
    /// Builds the single statement from the EF model's own table and column names, so a mapping change
    /// moves the SQL with it rather than breaking it silently.
    /// <para>
    /// The literal brace pair in the <c>jsonb</c> path operator is doubled because EF's raw-SQL builder
    /// runs the statement through <see cref="string.Format(string, object?[])"/> to substitute the
    /// <c>{0}</c> / <c>{1}</c> parameter placeholders; <c>'{{}}'</c> therefore reaches PostgreSQL as
    /// <c>'{}'</c>.
    /// </para>
    /// </summary>
    private static string BuildSql(IModel model)
    {
        MappedTable match = MappedTable.For(model, typeof(Match));
        MappedTable participant = MappedTable.For(model, typeof(MatchParticipant));
        MappedTable squad = MappedTable.For(model, typeof(Squad));

        string squadTable = squad.Table;
        string squadKey = squad.Column(nameof(Squad.Id));
        string squadDeleted = squad.Column(nameof(Squad.IsDeleted));

        string matchTable = match.Table;
        string matchKey = match.Column(nameof(Match.Id));
        string matchSquad = match.Column(nameof(Match.SquadId));
        string matchState = match.Column(nameof(Match.State));
        string matchLocation = match.Column(nameof(Match.Location));
        string matchConfirmedDay = match.Column(nameof(Match.ConfirmedDay));
        string matchCompletedAt = match.Column(nameof(Match.CompletedAt));
        string matchCandidateDays = match.Column(nameof(Match.CandidateDays));
        string matchLineup = match.Column(nameof(Match.KickoffLineup));
        string matchResult = match.Column(nameof(Match.RecordedResult));
        string matchDeleted = match.Column(nameof(Match.IsDeleted));

        string participantTable = participant.Table;
        string participantMatch = participant.Column(nameof(MatchParticipant.MatchId));
        string participantDeleted = participant.Column(nameof(MatchParticipant.IsDeleted));

        return
            $$$"""
            SELECT  s."{{{squadKey}}}"   AS squad_id,
                    m.match_id           AS match_id,
                    m.state              AS state,
                    m.location           AS location,
                    m.confirmed_day      AS confirmed_day,
                    m.candidate_days     AS candidate_days_json,
                    m.kickoff_lineup     AS kickoff_lineup_json,
                    m.recorded_result    AS recorded_result_json,
                    m.completed_at       AS completed_at,
                    m.participant_count  AS participant_count,
                    m.scheduling_instant AS scheduling_instant
            FROM    "{{{squadTable}}}" AS s
            LEFT JOIN LATERAL (
                SELECT  mm."{{{matchKey}}}"              AS match_id,
                        mm."{{{matchState}}}"            AS state,
                        mm."{{{matchLocation}}}"         AS location,
                        mm."{{{matchConfirmedDay}}}"     AS confirmed_day,
                        mm."{{{matchCompletedAt}}}"      AS completed_at,
                        mm."{{{matchCandidateDays}}}"::text  AS candidate_days,
                        mm."{{{matchLineup}}}"::text         AS kickoff_lineup,
                        mm."{{{matchResult}}}"::text         AS recorded_result,
                        (SELECT count(*) FROM "{{{participantTable}}}" AS p
                          WHERE p."{{{participantMatch}}}" = mm."{{{matchKey}}}"
                            AND NOT p."{{{participantDeleted}}}")::int AS participant_count,
                        COALESCE(
                            mm."{{{matchConfirmedDay}}}",
                            (SELECT min((d.value #>> '{{}}')::timestamptz)
                               FROM jsonb_array_elements(mm."{{{matchCandidateDays}}}") AS d)
                        ) AS scheduling_instant
                FROM    "{{{matchTable}}}" AS mm
                WHERE   mm."{{{matchSquad}}}" = s."{{{squadKey}}}"
                  AND   NOT mm."{{{matchDeleted}}}"
                ORDER BY scheduling_instant DESC NULLS LAST, mm."{{{matchKey}}}" DESC
                LIMIT   {1} + 1
            ) AS m ON TRUE
            WHERE   s."{{{squadKey}}}" = {0}
              AND   NOT s."{{{squadDeleted}}}"
            ORDER BY m.scheduling_instant DESC NULLS LAST, m.match_id DESC
            """;
    }

    /// <summary>
    /// One mapped table of the model, resolved to its table name and the store object its column names
    /// are read against.
    /// </summary>
    private readonly struct MappedTable
    {
        private readonly IEntityType _entity;
        private readonly StoreObjectIdentifier _store;

        private MappedTable(IEntityType entity, string table, StoreObjectIdentifier store)
        {
            _entity = entity;
            Table = table;
            _store = store;
        }

        /// <summary>The entity's table name as the model maps it.</summary>
        public string Table { get; }

        /// <summary>Resolves the mapped table of <paramref name="clrType"/> from the model.</summary>
        public static MappedTable For(IModel model, Type clrType)
        {
            IEntityType entity = model.FindEntityType(clrType)
                ?? throw new InvalidOperationException($"{clrType.Name} is not mapped.");
            string table = entity.GetTableName()
                ?? throw new InvalidOperationException($"{clrType.Name} has no table name.");

            return new MappedTable(entity, table, StoreObjectIdentifier.Table(table, entity.GetSchema()));
        }

        /// <summary>Resolves the column <paramref name="propertyName"/> is mapped to.</summary>
        public string Column(string propertyName) =>
            _entity.FindProperty(propertyName)?.GetColumnName(_store)
            ?? throw new InvalidOperationException(
                $"{_entity.ClrType.Name}.{propertyName} is not mapped to a column.");
    }
}
