using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A match's recorded result as a match read reports it: the fidelity the result was captured at and
/// the per-team final scores it carries (Requirement 1.6).
/// <para>
/// It derives from no persistence base type, so none of the <c>BaseEntity</c>-declared members — the
/// entity identity, the creation and update instants, the creating and updating actors, and the
/// soft-delete flag and instant — reach the wire (Requirements 8.3, 8.8). Both member types are
/// Domain <b>value</b> types rather than entities: <see cref="ResultFidelity"/> is an enum serialised
/// by member name through the one already-registered by-name JSON registration (Requirement 9.9), and
/// <see cref="TeamScore"/> is an identity-less value record — the same pairing
/// <see cref="CompleteMatchResult"/> already ships.
/// </para>
/// <para>
/// A match with no recorded result is reported by an explicit <see langword="null"/>-valued member on
/// the carrying contract rather than by omitting the member, so an entry for a <c>Completed</c> match
/// and an entry for a <c>GatheringAvailability</c> match are the same shape (Requirement 1.8).
/// </para>
/// </summary>
/// <param name="Fidelity">The fidelity at which the result was captured: <c>Basic</c> or <c>Rich</c>.</param>
/// <param name="TeamScores">The recorded per-team final scores, one per match team.</param>
public sealed record RecordedResultView(
    ResultFidelity Fidelity,
    IReadOnlyList<TeamScore> TeamScores);
