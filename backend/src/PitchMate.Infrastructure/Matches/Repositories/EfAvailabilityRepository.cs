using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Matches.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IAvailabilityRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Registered scoped so it shares the request's unit-of-work
/// transaction: upserts and removals are staged on the change tracker and committed by the
/// surrounding <c>IUnitOfWork.SaveChangesAsync</c> (Requirement 16.3).
/// <para>
/// A membership holds at most one response per match, guaranteed by the non-filtered unique index on
/// <c>(match_id, squad_membership_id)</c> declared in <c>AvailabilityResponseConfiguration</c>
/// (Requirement 4.2). Because that index does not exclude soft-deleted rows, both the upsert-replace
/// and the clear path remove the prior row <em>permanently</em> (via
/// <see cref="PitchMateDbContext.MarkForHardDelete"/>): a retained soft-deleted row would keep the
/// <c>(match_id, squad_membership_id)</c> pair and collide with a later insert on that index. A stored
/// response marking an empty subset of candidate days is a real row and so is distinct from the
/// member having no stored response at all (Requirement 4.7).
/// </para>
/// <para>
/// The per-day count and identities behind the availability tally are derived in the pure Domain
/// computation (<see cref="AvailabilityTally.Compute"/>) over the responses returned by
/// <see cref="ListResponsesAsync"/>. The database evaluates the response scan itself — a single
/// indexed <c>WHERE match_id = …</c> that materialises each response and its <c>jsonb</c> marked-day
/// subset — while the latest-response-per-member reduction and the per-day membership filtering, which
/// depend on the <c>jsonb</c> subset, stay in the Domain where the tally rules live (Requirement 5.1,
/// 5.3).
/// </para>
/// </summary>
internal sealed class EfAvailabilityRepository(PitchMateDbContext db) : IAvailabilityRepository
{
    /// <inheritdoc />
    public Task<AvailabilityResponse?> GetResponseAsync(
        Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken)
        // The unique index on (match_id, squad_membership_id) guarantees at most one match; the global
        // soft-delete query filter excludes any cleared row so a cleared member reads as having none
        // (Requirement 4.2, 4.3).
        => db.Set<AvailabilityResponse>()
            .FirstOrDefaultAsync(
                response => response.MatchId == matchId && response.SquadMembershipId == squadMembershipId,
                cancellationToken);

    /// <inheritdoc />
    public async Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(response);

        // The aggregate produces a fresh response (new identity) for each submission, so replacing the
        // member's prior response means removing the existing row and inserting the new one. The
        // removal is permanent so the incoming insert does not collide with a retained soft-deleted row
        // on the non-filtered unique index; EF orders the delete before the insert because they share
        // the same unique-index values (Requirement 4.1, 4.2).
        AvailabilityResponse? existing = await db.Set<AvailabilityResponse>()
            .FirstOrDefaultAsync(
                stored => stored.MatchId == response.MatchId
                    && stored.SquadMembershipId == response.SquadMembershipId,
                cancellationToken);

        if (existing is not null && !ReferenceEquals(existing, response))
        {
            db.Set<AvailabilityResponse>().Remove(existing);
            db.MarkForHardDelete(existing);
        }

        await db.Set<AvailabilityResponse>().AddAsync(response, cancellationToken);
    }

    /// <inheritdoc />
    public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(response);

        // Clearing reverts the member to having no stored response, so the row is removed permanently
        // rather than soft-deleted: a retained soft-deleted row would keep the (match_id,
        // squad_membership_id) pair and block a later resubmission on the unique index (Requirement 4.3).
        db.Set<AvailabilityResponse>().Remove(response);
        db.MarkForHardDelete(response);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(
        Guid matchId, CancellationToken cancellationToken)
        // The indexed match_id predicate is evaluated in the database, returning every stored response
        // (each with its jsonb marked-day subset) so the Domain can compute the tally over them; the
        // global soft-delete filter excludes cleared rows, and an empty list is returned when none are
        // stored (Requirement 5.1).
        => await db.Set<AvailabilityResponse>()
            .Where(response => response.MatchId == matchId)
            .ToListAsync(cancellationToken);
}
