using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Stats;

/// <summary>
/// EF Core implementation of <see cref="IMembershipStandingSource"/> over the shared
/// <see cref="PitchMateDbContext"/>. It sits beside <see cref="EfStatsRepository"/> so every
/// squad-scoped aggregation query lives in one place (Requirement 11.5), and answers the squad read
/// path's single standing question: how many completed matches of <i>this</i> squad each membership has
/// appeared in, plus that membership's current μ/σ where a rating exists (Requirement 10.10).
/// <para>
/// <b>One query.</b> The whole result is a single round trip: the squad's memberships left-joined to
/// their 1:1 <see cref="MembershipRating"/>, with the appearance count as a correlated subquery over
/// the squad's <see cref="MatchState.Completed"/> matches. Counting <i>matches</i> rather than team rows
/// makes the count inherently per-match, so a membership can never be double-counted within one match.
/// Because a match team's roster is a native <c>uuid[]</c> column (see
/// <c>MatchTeamConfiguration</c>), the containment test translates to a Postgres array predicate and
/// the entire filter — squad scoping, the completed-state restriction, and the roster membership —
/// is evaluated in the database; no match or team row is ever materialised. Squads are small (a
/// membership list, not a fact table), so the correlated count is the cheaper shape here than
/// materialising every completed lineup as <see cref="EfStatsRepository"/> must for the leaderboards.
/// </para>
/// <para>
/// <b>Scope.</b> Only matches whose <c>SquadId</c> is the requested squad and whose state is
/// <see cref="MatchState.Completed"/> contribute, so a non-completed match and another squad's match
/// are both invisible to the count (Requirement 10.10). Every query honours the global soft-delete
/// filter, so a deleted match, team, membership, or rating contributes nothing.
/// </para>
/// <para>
/// <b>No classification.</b> The source reports raw standing only — it compares no σ against any
/// threshold. Classifying a rating as provisional or established is the Domain rule
/// (<c>IRatingEngine.GetState</c>), applied by the consuming handler (Requirement 11.6).
/// </para>
/// <para>
/// Registered scoped so it shares the request scope's <see cref="PitchMateDbContext"/>.
/// </para>
/// </summary>
internal sealed class EfMembershipStandingSource(PitchMateDbContext db) : IMembershipStandingSource
{
    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<Guid, MembershipStanding>> ListForSquadAsync(
        Guid squadId,
        CancellationToken cancellationToken)
    {
        // One round trip: each membership of the squad, its appearance count over that squad's completed
        // matches, and its current μ/σ when a rating row exists (null for both when it does not).
        var rows = await (
            from member in db.Set<SquadMembership>()
            where member.SquadId == squadId
            join rating in db.Set<MembershipRating>()
                on member.Id equals rating.SquadMembershipId into ratings
            from rating in ratings.DefaultIfEmpty()
            select new
            {
                MembershipId = member.Id,
                Appearances = db.Set<Match>().Count(match =>
                    match.SquadId == squadId
                    && match.State == MatchState.Completed
                    && db.Set<MatchTeam>().Any(team =>
                        team.MatchId == match.Id && team.Roster.Contains(member.Id))),
                Mu = (double?)rating.Mu,
                Sigma = (double?)rating.Sigma
            })
            .ToListAsync(cancellationToken);

        // Report only memberships that have standing to report: the interface defines an absent entry as
        // "no appearances and no rating", which is precisely the row this skips (Requirement 10.4).
        var standing = new Dictionary<Guid, MembershipStanding>(rows.Count);
        foreach (var row in rows)
        {
            if (row.Appearances == 0 && row.Mu is null)
            {
                continue;
            }

            standing[row.MembershipId] = new MembershipStanding(row.Appearances, row.Mu, row.Sigma);
        }

        return standing;
    }
}
