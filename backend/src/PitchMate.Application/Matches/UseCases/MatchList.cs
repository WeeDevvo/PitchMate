namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The declared response contract of <c>GET /squads/{squadId}/matches</c>: the squad's matches as
/// bounded, ordered <see cref="MatchListEntry"/> values, plus whether the bound discarded any
/// (Requirements 1.1, 1.10).
/// <para>
/// The entries are ordered by each match's scheduling instant descending, tie-broken by match
/// identity descending (Requirement 1.9), and bounded at
/// <see cref="MatchListLimits.MaximumEntries"/>. <see cref="Truncated"/> is <see langword="true"/>
/// exactly when the admitted match count exceeded that maximum, so a client can tell a complete list
/// from a clipped one without a count endpoint.
/// </para>
/// <para>
/// A visible squad with no admitted match is reported as zero entries with
/// <see cref="Truncated"/> <see langword="false"/> — a success, not a concealment
/// (Requirement 1.11). It derives from no persistence base type (Requirements 8.8, 11.1).
/// </para>
/// </summary>
/// <param name="Matches">The squad's matches in the order of Requirement 1.9; may be empty, never <see langword="null"/>.</param>
/// <param name="Truncated"><see langword="true"/> when the admitted match count exceeded <see cref="MatchListLimits.MaximumEntries"/> and the remainder was discarded.</param>
public sealed record MatchList(
    IReadOnlyList<MatchListEntry> Matches,
    bool Truncated);
