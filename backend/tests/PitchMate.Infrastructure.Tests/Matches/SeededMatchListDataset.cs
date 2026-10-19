using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// The resolved, identity-bearing model of what <see cref="MatchListDatasetSeeder"/> actually
/// persisted: the seeded squads and, per squad, the <see cref="Match"/> aggregates themselves.
/// <para>
/// Carrying the aggregates rather than a parallel hand-written projection is deliberate. The
/// expectation for every member of a <c>MatchListEntry</c> — location, confirmed day, candidate days,
/// participant count, locked team names and bib flags, recorded result, completion instant — is read
/// straight off the aggregate that produced the row, and the expected <em>order</em> comes from the
/// Domain's own <see cref="MatchSchedulingOrder"/>. So the assertions compare the SQL against the
/// specification rather than against a second implementation of it.
/// </para>
/// </summary>
/// <param name="Squads">The seeded squads, in the order their specs were supplied.</param>
internal sealed record SeededMatchListDataset(IReadOnlyList<SeededMatchListDataset.SquadData> Squads)
{
    /// <summary>The seeded squad at <paramref name="index"/>.</summary>
    public SquadData SquadAt(int index) => Squads[index];

    /// <summary>One seeded squad and every match built in it, soft-deleted ones included.</summary>
    /// <param name="SquadId">The squad's identity.</param>
    /// <param name="Matches">Every match built in the squad, in creation order, soft-deleted ones included.</param>
    /// <param name="SoftDeletedMatchIds">The identities of the matches that were soft-deleted after seeding.</param>
    /// <param name="IsSoftDeleted">Whether the squad itself was soft-deleted after seeding.</param>
    /// <param name="Memberships">Every membership seeded in the squad — registered pool, then guests — in their final (possibly anonymised) state.</param>
    /// <param name="Responses">Every availability response stored for the squad's matches.</param>
    /// <param name="Ratings">The persisted rating of each rated membership.</param>
    internal sealed record SquadData(
        Guid SquadId,
        IReadOnlyList<Match> Matches,
        IReadOnlySet<Guid> SoftDeletedMatchIds,
        bool IsSoftDeleted,
        IReadOnlyList<PitchMate.Domain.Squads.SquadMembership> Memberships,
        IReadOnlyList<AvailabilityResponse> Responses,
        IReadOnlyDictionary<Guid, PitchMate.Domain.Rating.Rating> Ratings)
    {
        /// <summary>The squad's admin — the first registered membership, promoted on seeding.</summary>
        public PitchMate.Domain.Squads.SquadMembership Organiser => Memberships[0];

        /// <summary>The membership with the given identity.</summary>
        public PitchMate.Domain.Squads.SquadMembership MembershipById(Guid membershipId) =>
            Memberships.Single(membership => membership.Id == membershipId);

        /// <summary>The stored response of a membership for a match, or <see langword="null"/>.</summary>
        public AvailabilityResponse? ResponseOf(Guid matchId, Guid membershipId) =>
            Responses.SingleOrDefault(response => response.MatchId == matchId && response.SquadMembershipId == membershipId);

        /// <summary>
        /// The matches the read must admit: every match of the squad that is not soft-deleted,
        /// regardless of lifecycle state — the read applies no state filter of its own.
        /// </summary>
        public IReadOnlyList<Match> Admitted =>
            [.. Matches.Where(match => !SoftDeletedMatchIds.Contains(match.Id))];

        /// <summary>
        /// The admitted matches in the order Requirement 1.9 specifies, as the Domain comparator
        /// defines it — scheduling instant descending, tie-broken by identity descending.
        /// </summary>
        public IReadOnlyList<Match> ExpectedOrder => MatchSchedulingOrder.ForMatchList(Admitted);

        /// <summary>The seeded match with the given identity.</summary>
        public Match MatchById(Guid matchId) => Matches.Single(match => match.Id == matchId);
    }
}
