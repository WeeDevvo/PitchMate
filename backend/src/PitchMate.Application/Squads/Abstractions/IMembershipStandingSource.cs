namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// One squad-scoped read of per-membership appearance counts and current μ/σ, so the squad read model
/// can distinguish a membership that has never played from one whose rating is still settling
/// (api-response-contracts decision D7, Requirement 10.2).
/// <para>
/// The abstraction is declared here, beside its consumer (<c>GetSquadHandler</c>), so the squad read
/// path takes no dependency on the stats use-case namespace (Requirement 11.4). It is implemented in
/// <c>PitchMate.Infrastructure</c> alongside the existing squad-scoped stats aggregation, so all
/// squad-scoped aggregation SQL stays in one place (Requirement 11.5).
/// </para>
/// <para>
/// The source reports raw standing only: μ and σ never leave the backend on the squad read path — the
/// handler classifies them through the Domain rule (<c>IRatingEngine.GetState</c>) and projects the
/// classification alone (Requirement 10.7, 11.6).
/// </para>
/// </summary>
public interface IMembershipStandingSource
{
    /// <summary>
    /// Reads, in a single squad-scoped query, every membership of <paramref name="squadId"/> that has
    /// any standing to report, keyed by membership identity. A membership absent from the result has no
    /// appearances and no rating (Requirement 10.2, 10.4).
    /// </summary>
    /// <param name="squadId">The squad whose memberships' standing is read.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The per-membership standing, keyed by membership identity.</returns>
    Task<IReadOnlyDictionary<Guid, MembershipStanding>> ListForSquadAsync(
        Guid squadId,
        CancellationToken cancellationToken);
}
