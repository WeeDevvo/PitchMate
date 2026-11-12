namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// The facts a squad card on the squads home shows beyond the squad's name and the viewer's role: how
/// many active players it has, its next open match, and the viewer's recent form there.
/// <para>
/// Declared here, beside its consumer (<c>ListMySquadsHandler</c>), so the squad read path takes no
/// dependency on the stats or matches use-case namespaces. It is implemented in
/// <c>PitchMate.Infrastructure</c> alongside the existing squad-scoped stats aggregation, so all
/// squad-scoped aggregation stays in one place, and it derives each result by the same rule the stats
/// read uses.
/// </para>
/// </summary>
public interface ISquadCardSource
{
    /// <summary>Reads the card facts for one squad, as seen by one membership.</summary>
    /// <param name="squadId">The squad whose card is read.</param>
    /// <param name="membershipId">
    /// The viewer's membership in the squad, whose recent form is read, or <see langword="null"/> when the
    /// viewer holds none (the form is then empty).
    /// </param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    Task<SquadCardFacts> ReadAsync(Guid squadId, Guid? membershipId, CancellationToken cancellationToken);
}
