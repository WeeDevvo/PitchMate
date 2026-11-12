using PitchMate.Domain.Stats;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>The facts <see cref="ISquadCardSource"/> reports for one squad card.</summary>
/// <param name="PlayerCount">The squad's active memberships, guests included; never negative.</param>
/// <param name="NextMatch">The squad's next open match, or <see langword="null"/> when it has none.</param>
/// <param name="RecentForm">
/// The viewer's results in their most recent completed matches of the squad, at most five, oldest first.
/// </param>
public sealed record SquadCardFacts(
    int PlayerCount,
    UpcomingMatchFacts? NextMatch,
    IReadOnlyList<PlayerResult> RecentForm);
