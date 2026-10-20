using PitchMate.Application.Matches.UseCases;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// One page of the match list read as <see cref="IMatchListSource"/> reports it: the ordered, bounded
/// entries the source admitted, plus whether it saw more matches than the caller's limit allowed
/// (Requirement 1.10).
/// <para>
/// <see cref="Truncated"/> is decided by the <b>source</b>, not by the handler, because the source is
/// the only party that holds the <c>limit + 1</c>-th row — see
/// <see cref="IMatchListSource.ListForSquadAsync"/> for the admission rule. The handler carries the
/// signal onto <see cref="MatchList.Truncated"/> unchanged, which is what keeps the bound inside the
/// database and out of the Api (Requirement 1.12).
/// </para>
/// <para>
/// A page is returned for every <b>visible</b> squad, including one with no admitted match, which is
/// reported as zero <see cref="Entries"/> with <see cref="Truncated"/> <see langword="false"/>
/// (Requirement 1.11). A squad that is not visible is reported by a <see langword="null"/>
/// <c>MatchListPage</c> rather than by an empty one (Requirement 5.9).
/// </para>
/// </summary>
/// <param name="Entries">
/// The admitted matches in the order of Requirement 1.9 — scheduling instant descending, tie-broken
/// by match identity descending — clipped to the requested limit. May be empty; never
/// <see langword="null"/>.
/// </param>
/// <param name="Truncated">
/// <see langword="true"/> exactly when the source admitted more matches than the requested limit and
/// the remainder was discarded from <see cref="Entries"/>; otherwise <see langword="false"/>.
/// </param>
public sealed record MatchListPage(
    IReadOnlyList<MatchListEntry> Entries,
    bool Truncated);
