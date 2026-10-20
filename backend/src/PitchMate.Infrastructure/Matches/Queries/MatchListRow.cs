namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// One row of <see cref="EfMatchListSource"/>'s single statement: a squad-visibility marker plus, for
/// a squad that has at least one admitted match, that match's list projection.
/// <para>
/// This is an <b>unmapped</b> row type materialised by
/// <see cref="Microsoft.EntityFrameworkCore.RelationalDatabaseFacadeExtensions"/>'s
/// <c>SqlQueryRaw&lt;T&gt;</c>, deliberately <b>not</b> a keyless entity type: registering one would be
/// an <see cref="Microsoft.EntityFrameworkCore.IEntityTypeConfiguration{TEntity}"/> change, which the
/// chore's scope forbids (Requirement 11.6). An unmapped row type admits only provider-mappable
/// scalars, which is why the match's three <c>jsonb</c> columns arrive here as <c>::text</c>
/// (<see cref="CandidateDaysJson"/>, <see cref="KickoffLineupJson"/>,
/// <see cref="RecordedResultJson"/>) and are rehydrated through the <em>same</em>
/// <c>MatchValueObjectJson</c> deserialisers the entity configuration's value converters use, and why
/// <see cref="State"/> arrives as the stable <see cref="int"/> the column stores.
/// </para>
/// <para>
/// <b>Every match-side member is nullable.</b> The statement's <c>LEFT JOIN LATERAL … ON TRUE</c> is
/// what distinguishes "squad visible but has no admitted match" — exactly one row whose
/// <see cref="MatchId"/> is <see langword="null"/> — from "squad not visible", which is zero rows,
/// without a second query (Requirement 1.11). A row with a non-null <see cref="MatchId"/> carries
/// every other match member.
/// </para>
/// <para>
/// A mutable class with a parameterless constructor rather than a record: the materialiser sets the
/// properties by name from the result set's columns, so the type carries no behaviour and never
/// escapes this assembly.
/// </para>
/// </summary>
internal sealed class MatchListRow
{
    /// <summary>
    /// The visible squad's identity, from the statement's outer table. Always present — a row exists
    /// only where the squad passed <c>WHERE s.id = … AND NOT s.is_deleted</c>.
    /// </summary>
    public Guid SquadId { get; set; }

    /// <summary>
    /// The match's identity, or <see langword="null"/> on the single placeholder row the lateral join
    /// yields for a visible squad with no admitted match.
    /// </summary>
    public Guid? MatchId { get; set; }

    /// <summary>The match's lifecycle state as the stable numeric value the <c>state</c> column stores.</summary>
    public int? State { get; set; }

    /// <summary>The match's location, verbatim as the match row holds it.</summary>
    public string? Location { get; set; }

    /// <summary>The match's confirmed day, or <see langword="null"/> while it is gathering availability.</summary>
    public DateTimeOffset? ConfirmedDay { get; set; }

    /// <summary>The <c>candidate_days</c> <c>jsonb</c> document read as text.</summary>
    public string? CandidateDaysJson { get; set; }

    /// <summary>The <c>kickoff_lineup</c> <c>jsonb</c> document read as text, or <see langword="null"/> before the first lock.</summary>
    public string? KickoffLineupJson { get; set; }

    /// <summary>The <c>recorded_result</c> <c>jsonb</c> document read as text, or <see langword="null"/> before a result is recorded.</summary>
    public string? RecordedResultJson { get; set; }

    /// <summary>The match's completion instant, or <see langword="null"/> before completion.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>
    /// The match's participant count, evaluated in the database as a correlated <c>count(*)</c> and
    /// narrowed to <c>int</c> in SQL because PostgreSQL's <c>count</c> yields <c>bigint</c> while an
    /// unmapped row member must match the result column's provider type exactly. A match's playing
    /// pool is a handful of players, so the narrowing cannot overflow.
    /// </summary>
    public int? ParticipantCount { get; set; }

    /// <summary>
    /// The ordering key of Requirement 1.9 — the confirmed day where the match has one, otherwise the
    /// earliest of its candidate days — evaluated in the database and selected so the outer
    /// <c>ORDER BY</c> can re-apply it.
    /// </summary>
    public DateTimeOffset? SchedulingInstant { get; set; }
}
