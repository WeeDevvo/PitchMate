using PitchMate.Application.Matches.UseCases;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// The match list read's query source: one squad-scoped read that composes a squad's
/// <see cref="MatchListEntry"/> values from the existing normalised match tables, evaluating the
/// participant count, the ordering of Requirement 1.9 and the bound of Requirement 1.10 inside the
/// database and reading no denormalised summary table (Requirement 1.12).
/// <para>
/// The abstraction is declared here, beside the match use cases that consume it, and implemented in
/// <c>PitchMate.Infrastructure</c> over <c>PitchMateDbContext</c> and registered from
/// Infrastructure's own registration extension, so no Application or Api type names the
/// implementation (Requirement 11.2). Nothing in this file names an EF Core, Npgsql or Infrastructure
/// type.
/// </para>
/// </summary>
public interface IMatchListSource
{
    /// <summary>
    /// Reads, in a single statement, the squad's matches as ordered, bounded
    /// <see cref="MatchListEntry"/> values together with the truncation signal.
    /// <para>
    /// <b>The <see langword="null"/> return means the squad is not visible</b> — it does not exist, or
    /// it is excluded by the soft-delete query filter because it is within its deletion grace period
    /// (Requirement 5.9). A <b>visible</b> squad with no admitted match returns an <b>empty page</b> —
    /// a <see cref="MatchListPage"/> with zero <see cref="MatchListPage.Entries"/> and
    /// <see cref="MatchListPage.Truncated"/> <see langword="false"/> — and never
    /// <see langword="null"/> (Requirement 1.11).
    /// </para>
    /// <para>
    /// That distinction is the whole point of this contract: it is what lets the handler answer
    /// <c>200 OK</c> with an empty list for the visible-but-empty squad and conceal the squad for the
    /// not-visible one, <b>without a second query</b>. The implementation must therefore make squad
    /// visibility part of this one statement rather than inferring it from the match rows — zero match
    /// rows is not evidence that the squad is absent, and resolving a membership is not evidence that
    /// the squad is visible, because a squad's soft-delete does not cascade to its memberships.
    /// </para>
    /// <para>
    /// <b>Admission rule:</b> the implementation admits <b>at most <paramref name="limit"/> + 1</b>
    /// matching rows, returns the first <paramref name="limit"/> of them as
    /// <see cref="MatchListPage.Entries"/>, and sets <see cref="MatchListPage.Truncated"/> to
    /// <see langword="true"/> exactly when the admitted row count exceeded <paramref name="limit"/>.
    /// The extra row <i>is</i> the truncation signal, so no <c>COUNT(*)</c> and no second round trip is
    /// needed (Requirement 1.13).
    /// </para>
    /// <para>
    /// The entries are ordered by each match's scheduling instant descending — the match's confirmed
    /// day where it has one and otherwise the earliest of its candidate days — tie-broken by match
    /// identity descending, which is a total order over any set of matches (Requirement 1.9). The
    /// bound of Requirement 1.10 is applied to <i>that</i> order, so the retained entries are the most
    /// recently scheduled ones.
    /// </para>
    /// <para>
    /// The read mutates no persisted state, so two successive calls with no intervening write return
    /// equal pages (Requirement 1.14).
    /// </para>
    /// </summary>
    /// <param name="squadId">The squad whose matches are read, and whose visibility this call decides.</param>
    /// <param name="limit">
    /// The maximum number of entries to return — <see cref="MatchListLimits.MaximumEntries"/> on the
    /// read path. At most <paramref name="limit"/> + 1 rows are admitted so truncation is detectable.
    /// </param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>
    /// The squad's ordered, bounded entries plus the truncation signal; an empty page where the squad
    /// is visible but has no admitted match; or <see langword="null"/> where the squad is not visible.
    /// </returns>
    Task<MatchListPage?> ListForSquadAsync(
        Guid squadId,
        int limit,
        CancellationToken cancellationToken);
}
