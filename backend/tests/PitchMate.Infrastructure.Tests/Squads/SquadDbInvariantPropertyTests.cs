using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PitchMate.Application.Common;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Generators;
using PitchMate.Infrastructure.Tests.Persistence;

// Disambiguate the domain result type from FsCheck's own Result type.
using SquadResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Infrastructure.Tests.Squads;

/// <summary>
/// DB-backed property tests for the squad correctness properties whose guarantee is a
/// <em>database</em> invariant — atomic multi-row rollback, the single-owner filtered unique index,
/// membership deactivation retaining rows, the guest-claim rebind round trip, soft-delete filtering,
/// deletion reversal, and erasure's anonymise-vs-remove branch (task 18.5; design Properties 1, 13,
/// 14, 30, 34, 36, 38). Each is exercised through the real use-case handlers and EF Core
/// repositories over a <em>real</em> PostgreSQL database provisioned by the shared Testcontainers
/// fixture — never the EF in-memory provider or SQLite — with the production EF Core migrations
/// (including <c>AddSquadsAndMembership</c>) applied to a fresh database, so the filtered unique
/// indexes, the backing <c>CHECK</c> constraint, transaction rollback, and the soft-delete query
/// filter are all the real ones under test.
/// <para>
/// Each iteration works against a freshly generated squad identity, so iterations are naturally
/// isolated on the shared migrated database. FsCheck's property model is synchronous, so each
/// iteration's asynchronous database work is bridged with <see cref="RunAsync"/> — a deadlock-free
/// block in a test-only context with no synchronization context. Requires Docker.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class SquadDbInvariantPropertyTests
{
    private const int Iterations = 100;

    // The migrated database is created once per test run on the shared container and reused by every
    // iteration. FsCheck.Xunit's property test cases do not invoke a test class's IAsyncLifetime, so
    // the migrated database is provisioned lazily behind this guard (the collection fixture that owns
    // the container IS initialised by xUnit, and disposing it drops this database with it).
    private static readonly SemaphoreSlim InitLock = new(1, 1);
    private static string? _migratedConnectionString;

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public SquadDbInvariantPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>
    /// Ensures a fresh, empty database exists on the shared server with the production EF Core
    /// migrations applied to it — so the squad tables, filtered unique indexes, and constraints under
    /// test are exactly those the migrations produce (coding-standards: apply migrations against the
    /// container) — and returns its connection string. Runs once per test run; later callers reuse it.
    /// </summary>
    private async Task<string> EnsureMigratedDatabaseAsync()
    {
        if (_migratedConnectionString is not null)
        {
            return _migratedConnectionString;
        }

        await InitLock.WaitAsync();
        try
        {
            if (_migratedConnectionString is null)
            {
                var databaseName = "squadinv_" + Guid.NewGuid().ToString("N");
                await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

                var connectionString = new NpgsqlConnectionStringBuilder(_fixture.ConnectionString)
                {
                    Database = databaseName,
                }.ConnectionString;

                await using var context = new PitchMateDbContext(
                    MigrationTestSupport.BuildContextOptions(connectionString),
                    new FakeTimeProvider(),
                    new FakeCurrentUserAccessor());
                await context.Database.MigrateAsync();

                _migratedConnectionString = connectionString;
            }
        }
        finally
        {
            InitLock.Release();
        }

        return _migratedConnectionString;
    }

    // Feature: squads-and-membership, Property 1: Squad creation produces one active owner and all features disabled
    /// <summary>
    /// DB portion of Property 1. Creating a squad through <see cref="CreateSquadHandler"/> commits, in
    /// one transaction, a <see cref="Squad"/> with the trimmed name plus exactly one
    /// <see cref="SquadRole.Owner"/> membership that is <see cref="MembershipState.Active"/>, backed by
    /// the creating user, with every <see cref="SquadFeature"/> flag persisted disabled; and when a step
    /// of a multi-row create fails (a second owner violating the single-owner index), the whole save
    /// rolls back so neither the squad nor any membership is persisted.
    ///
    /// **Validates: Requirements 1.1, 6.1, 17.1**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property CreatingASquadPersistsOneActiveOwnerAndAllFeaturesDisabledAtomically(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var ownerUserId = Guid.CreateVersion7();

            // --- Success: the atomic create persists the squad + single owner + disabled flags. ---
            var (squadId, ownerMembershipId) =
                await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);

            bool successHolds;
            await using (var verify = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var squad = await new EfSquadRepository(verify).GetByIdAsync(squadId, CancellationToken.None);
                var owner = await verify.Set<SquadMembership>().SingleAsync(m => m.Id == ownerMembershipId);

                var members = await verify.Set<SquadMembership>()
                    .Where(m => m.SquadId == squadId)
                    .ToListAsync();

                var expectedFeatureCount = Enum.GetValues<SquadFeature>().Length;

                successHolds = squad is not null
                    && squad.Name == scenario.SquadName.Trim()
                    && members.Count == 1
                    && owner.Role == SquadRole.Owner
                    && owner.State == MembershipState.Active
                    && owner.UserId == ownerUserId
                    && owner.DisplayName == scenario.OwnerName.Trim()
                    && squad.Features.Count == expectedFeatureCount
                    && squad.Features.All(flag => !flag.IsEnabled);
            }

            // --- Rollback: a multi-row create whose second owner violates the single-owner index
            //     leaves nothing behind (the squad is never persisted). ---
            var rolledBackSquad = Squad.Create(scenario.SquadName).Value!;
            var firstOwner = SquadMembership.CreateOwner(rolledBackSquad.Id, Guid.CreateVersion7(), scenario.OwnerName).Value!;
            var secondOwner = SquadMembership.CreateOwner(rolledBackSquad.Id, Guid.CreateVersion7(), scenario.SecondName).Value!;

            var threw = false;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var squads = new EfSquadRepository(context);
                var memberships = new EfSquadMembershipRepository(context);
                var unitOfWork = new UnitOfWork(context);

                await squads.AddAsync(rolledBackSquad, CancellationToken.None);
                await memberships.AddAsync(firstOwner, CancellationToken.None);
                await memberships.AddAsync(secondOwner, CancellationToken.None);

                try
                {
                    await unitOfWork.SaveChangesAsync(CancellationToken.None);
                }
                catch (Exception)
                {
                    threw = true;
                }
            }

            bool rollbackHolds;
            await using (var verify = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var squad = await verify.Set<Squad>()
                    .IgnoreQueryFilters()
                    .FirstOrDefaultAsync(s => s.Id == rolledBackSquad.Id);
                var anyMembership = await verify.Set<SquadMembership>()
                    .IgnoreQueryFilters()
                    .AnyAsync(m => m.SquadId == rolledBackSquad.Id);

                rollbackHolds = threw && squad is null && !anyMembership;
            }

            return successHolds && rollbackHolds;
        });
    }

    // Feature: squads-and-membership, Property 13: Ownership transfer is an atomic owner/admin swap
    /// <summary>
    /// DB portion of Property 13. The <c>(squad_id) WHERE role = Owner</c> filtered unique index holds
    /// throughout: a direct attempt to persist a second owner for a squad is rejected by the database
    /// and the owner count stays one; and an ownership transfer through
    /// <see cref="TransferOwnershipHandler"/> commits the demote-old / promote-new pair in one
    /// transaction, leaving the target as the sole <see cref="SquadRole.Owner"/> and the former owner an
    /// <see cref="SquadRole.Admin"/>.
    ///
    /// **Validates: Requirements 6.1, 6.2**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property SingleOwnerIndexHoldsAndOwnershipTransferIsAnAtomicSwap(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var ownerUserId = Guid.CreateVersion7();
            var targetUserId = Guid.CreateVersion7();

            var (squadId, ownerMembershipId) =
                await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);

            // --- The single-owner index rejects a second owner directly. ---
            var extraOwner = SquadMembership.CreateOwner(squadId, Guid.CreateVersion7(), scenario.SecondName).Value!;
            var secondOwnerRejected = false;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var memberships = new EfSquadMembershipRepository(context);
                var unitOfWork = new UnitOfWork(context);
                await memberships.AddAsync(extraOwner, CancellationToken.None);
                try
                {
                    await unitOfWork.SaveChangesAsync(CancellationToken.None);
                }
                catch (Exception)
                {
                    secondOwnerRejected = true;
                }
            }

            var ownersAfterReject = await CountOwnersAsync(squadId);

            // --- The atomic owner/admin swap. ---
            var targetMembershipId =
                await AddRegisteredMemberAsync(squadId, targetUserId, scenario.ThirdName, clock);

            SquadResult transfer;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                var memberships = new EfSquadMembershipRepository(context);
                var unitOfWork = new UnitOfWork(context);
                var handler = new TransferOwnershipHandler(memberships, unitOfWork);
                transfer = await handler.HandleAsync(
                    new TransferOwnershipCommand(ownerUserId, squadId, targetMembershipId), CancellationToken.None);
            }

            var ownersAfterTransfer = await CountOwnersAsync(squadId);
            var formerOwner = await GetMembershipAsync(ownerMembershipId);
            var newOwner = await GetMembershipAsync(targetMembershipId);

            return secondOwnerRejected
                && ownersAfterReject == 1
                && transfer.IsSuccess
                && ownersAfterTransfer == 1
                && newOwner!.Role == SquadRole.Owner
                && newOwner.State == MembershipState.Active
                && formerOwner!.Role == SquadRole.Admin
                && formerOwner.State == MembershipState.Active;
        });
    }

    // Feature: squads-and-membership, Property 14: Leaving and removal deactivate while retaining history
    /// <summary>
    /// DB portion of Property 14. Both leaving (via <see cref="LeaveSquadHandler"/>) and removal (via
    /// <see cref="RemoveMemberHandler"/>) set the target membership's state to
    /// <see cref="MembershipState.Inactive"/> while retaining the row in the database (memberships are
    /// never soft-deleted), so history hanging off the membership is preserved.
    ///
    /// **Validates: Requirements 7.1, 8.1**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property LeavingAndRemovalRetainTheRowAndSetItInactive(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var ownerUserId = Guid.CreateVersion7();
            var leaverUserId = Guid.CreateVersion7();
            var removedUserId = Guid.CreateVersion7();

            var (squadId, _) = await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);

            var leaverMembershipId = await AddRegisteredMemberAsync(squadId, leaverUserId, scenario.SecondName, clock);
            var removedMembershipId = await AddRegisteredMemberAsync(squadId, removedUserId, scenario.ThirdName, clock);

            // --- Leave. ---
            SquadResult leave;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(leaverUserId.ToString())))
            {
                var memberships = new EfSquadMembershipRepository(context);
                var unitOfWork = new UnitOfWork(context);
                var handler = new LeaveSquadHandler(memberships, unitOfWork);
                leave = await handler.HandleAsync(new LeaveSquadCommand(leaverUserId, squadId), CancellationToken.None);
            }

            // --- Removal. ---
            SquadResult remove;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                var memberships = new EfSquadMembershipRepository(context);
                var unitOfWork = new UnitOfWork(context);
                var handler = new RemoveMemberHandler(memberships, unitOfWork);
                remove = await handler.HandleAsync(
                    new RemoveMemberCommand(ownerUserId, squadId, removedMembershipId), CancellationToken.None);
            }

            var leaver = await GetMembershipAsync(leaverMembershipId);
            var removed = await GetMembershipAsync(removedMembershipId);

            return leave.IsSuccess
                && remove.IsSuccess
                && leaver is not null
                && leaver.State == MembershipState.Inactive
                && removed is not null
                && removed.State == MembershipState.Inactive;
        });
    }

    // Feature: squads-and-membership, Property 30: Guest claim is a history-preserving, consent-gated, reversible round trip
    /// <summary>
    /// DB portion of Property 30. Completing a consented guest claim (via
    /// <see cref="CompleteGuestClaimHandler"/>) rebinds the guest membership onto its target user as a
    /// registered <see cref="SquadRole.Member"/>, sets the claim-completed flag, and leaves the
    /// membership's identity, state, and display name unchanged; reversing it (via
    /// <see cref="ReverseGuestClaimHandler"/>) rebinds it back to a guest and clears the flag, again
    /// preserving identity, state, and name — so the row (and any history hanging off it) survives the
    /// round trip in the database.
    ///
    /// **Validates: Requirements 15.1**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property GuestClaimIsAHistoryPreservingReversibleRoundTrip(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var ownerUserId = Guid.CreateVersion7();
            var targetUserId = Guid.CreateVersion7();

            var (squadId, _) = await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);

            // Create the guest through the real handler.
            Guid guestMembershipId;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                var squads = new EfSquadRepository(context);
                var memberships = new EfSquadMembershipRepository(context);
                var unitOfWork = new UnitOfWork(context);
                var handler = new CreateGuestHandler(squads, memberships, unitOfWork, clock);
                var created = await handler.HandleAsync(
                    new CreateGuestCommand(ownerUserId, squadId, scenario.ThirdName, SkillTier: null, LawfulBasisAcknowledged: true),
                    CancellationToken.None);
                guestMembershipId = created.Value!.GuestMembershipId;
            }

            var expectedName = scenario.ThirdName.Trim();

            // Persist a consented, still-open claim for the guest membership.
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                var claims = new EfGuestClaimRepository(context);
                var unitOfWork = new UnitOfWork(context);
                var claim = GuestClaim.Initiate(guestMembershipId, targetUserId);
                claim.RecordConsent(clock.GetUtcNow());
                await claims.AddAsync(claim, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            // --- Complete the claim. ---
            SquadResult complete;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                complete = await new CompleteGuestClaimHandler(
                        new EfSquadRepository(context),
                        new EfSquadMembershipRepository(context),
                        new EfGuestClaimRepository(context),
                        new UnitOfWork(context),
                        clock)
                    .HandleAsync(new CompleteGuestClaimCommand(ownerUserId, squadId, guestMembershipId), CancellationToken.None);
            }

            var afterComplete = await GetMembershipAsync(guestMembershipId);
            var completeHolds = complete.IsSuccess
                && afterComplete is not null
                && afterComplete.UserId == targetUserId
                && afterComplete.Role == SquadRole.Member
                && afterComplete.ClaimCompleted
                && afterComplete.State == MembershipState.Active
                && afterComplete.DisplayName == expectedName;

            // --- Reverse the claim. ---
            SquadResult reverse;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                reverse = await new ReverseGuestClaimHandler(
                        new EfSquadRepository(context),
                        new EfSquadMembershipRepository(context),
                        new EfGuestClaimRepository(context),
                        new UnitOfWork(context),
                        clock)
                    .HandleAsync(new ReverseGuestClaimCommand(ownerUserId, squadId, guestMembershipId), CancellationToken.None);
            }

            var afterReverse = await GetMembershipAsync(guestMembershipId);
            var reverseHolds = reverse.IsSuccess
                && afterReverse is not null
                && afterReverse.UserId is null
                && afterReverse.Role is null
                && !afterReverse.ClaimCompleted
                && afterReverse.State == MembershipState.Active
                && afterReverse.DisplayName == expectedName;

            return completeHolds && reverseHolds;
        });
    }

    // Feature: squads-and-membership, Property 34: Squad deletion sets a grace purge instant and is idempotent
    /// <summary>
    /// DB portion of Property 34. Deleting a squad (via <see cref="DeleteSquadHandler"/>) soft-deletes
    /// it — so it disappears from default reads through the global soft-delete query filter while
    /// remaining visible when the filter is bypassed — and records a purge instant of the clock instant
    /// plus the grace period; a second delete after the clock advances is idempotent, leaving the
    /// existing purge instant unchanged.
    ///
    /// **Validates: Requirements 17.1, 17.4**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property DeletionSoftDeletesWithAGracePurgeInstantAndIsIdempotent(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var deleteInstant = clock.GetUtcNow();
            var ownerUserId = Guid.CreateVersion7();

            var (squadId, ownerMembershipId) =
                await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);

            var expectedPurgeAt = deleteInstant.AddDays(scenario.GracePeriodDays);

            // --- First delete. ---
PitchMate.Domain.Squads.Result<DeleteSquadResult> firstDelete;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                firstDelete = await BuildDeleteHandler(context, clock).HandleAsync(
                    new DeleteSquadCommand(ownerUserId, squadId, scenario.GracePeriodDays), CancellationToken.None);
            }

            // Soft-delete filtering: excluded from default reads, present when the filter is bypassed.
            var visibleByDefault = await GetSquadDefaultAsync(squadId);
            var stored = await GetSquadIncludingDeletedAsync(squadId);

            // History retained: the owner membership row survives the soft-delete.
            var ownerRetained = await GetMembershipAsync(ownerMembershipId);

            var firstHolds = firstDelete.IsSuccess
                && visibleByDefault is null
                && stored is not null
                && stored.IsDeleted
                && stored.PurgeAt == expectedPurgeAt
                && ownerRetained is not null;

            // --- Idempotent second delete after the clock advances (within the grace period). ---
            clock.SetUtcNow(deleteInstant.AddHours(12));
            PitchMate.Domain.Squads.Result<DeleteSquadResult> secondDelete;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                secondDelete = await BuildDeleteHandler(context, clock).HandleAsync(
                    new DeleteSquadCommand(ownerUserId, squadId, scenario.GracePeriodDays), CancellationToken.None);
            }

            var afterSecond = await GetSquadIncludingDeletedAsync(squadId);
            var idempotentHolds = secondDelete.IsSuccess
                && afterSecond is not null
                && afterSecond.IsDeleted
                && afterSecond.PurgeAt == expectedPurgeAt;

            return firstHolds && idempotentHolds;
        });
    }

    // Feature: squads-and-membership, Property 36: Deletion reversal restores the full pre-deletion state
    /// <summary>
    /// DB portion of Property 36. A squad that is soft-deleted and then reversed (via
    /// <see cref="ReverseSquadDeletionHandler"/>) before its purge instant is restored: it is visible to
    /// default reads again with its purge instant cleared, and every membership (role, state, display
    /// name) and every feature-flag state comes back identical to its pre-deletion value.
    ///
    /// **Validates: Requirements 17.1, 17.4**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property DeletionReversalRestoresTheFullPreDeletionState(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var ownerUserId = Guid.CreateVersion7();
            var memberUserId = Guid.CreateVersion7();

            var (squadId, ownerMembershipId) =
                await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);
            var memberMembershipId = await AddRegisteredMemberAsync(squadId, memberUserId, scenario.SecondName, clock);

            // Enable a feature so the pre-deletion state is non-trivial.
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                var squad = await context.Set<Squad>().FirstAsync(s => s.Id == squadId);
                squad.SetFeature(SquadFeature.LiveMatchTracking, true);
                await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
            }

            // --- Delete then reverse. ---
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                await BuildDeleteHandler(context, clock).HandleAsync(
                    new DeleteSquadCommand(ownerUserId, squadId, scenario.GracePeriodDays), CancellationToken.None);
            }

            SquadResult reverse;
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                var handler = new ReverseSquadDeletionHandler(
                    new EfSquadMembershipRepository(context),
                    new EfSquadRepository(context),
                    new EfRepository<Squad>(context),
                    new UnitOfWork(context));
                reverse = await handler.HandleAsync(new ReverseSquadDeletionCommand(ownerUserId, squadId), CancellationToken.None);
            }

            // The squad is visible to default reads again, with the purge instant cleared, and its
            // memberships and feature flags are intact.
            bool restored;
            await using (var verify = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var squad = await new EfSquadRepository(verify).GetByIdAsync(squadId, CancellationToken.None);
                var owner = await verify.Set<SquadMembership>().SingleAsync(m => m.Id == ownerMembershipId);
                var member = await verify.Set<SquadMembership>().SingleAsync(m => m.Id == memberMembershipId);

                restored = squad is not null
                    && !squad.IsDeleted
                    && squad.PurgeAt is null
                    && squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking)
                    && owner.Role == SquadRole.Owner
                    && owner.State == MembershipState.Active
                    && owner.DisplayName == scenario.OwnerName.Trim()
                    && member.Role == SquadRole.Member
                    && member.State == MembershipState.Active
                    && member.DisplayName == scenario.SecondName.Trim();
            }

            return reverse.IsSuccess && restored;
        });
    }

    // Feature: squads-and-membership, Property 38: Erasure anonymises history-bearing memberships and removes the rest
    /// <summary>
    /// DB portion of Property 38. Erasing a membership through <see cref="EraseMembershipHandler"/>
    /// branches on match history: a history-bearing membership is anonymised — its display name becomes
    /// the fixed placeholder, its normalised key is cleared (freeing the former name and exempting the
    /// row from the uniqueness index), its backing user is cleared, and the de-identified row is retained
    /// — while a membership with no history is permanently removed from the database.
    ///
    /// **Validates: Requirements 18.1**
    /// </summary>
    [Property(MaxTest = Iterations, Arbitrary = new[] { typeof(SquadDbInvariantArbitraries) })]
    public Property ErasureAnonymisesHistoryBearingMembershipsAndRemovesTheRest(SquadDbScenario scenario)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider();
            var ownerUserId = Guid.CreateVersion7();
            var historyUserId = Guid.CreateVersion7();
            var noHistoryUserId = Guid.CreateVersion7();

            var (squadId, _) = await CreateSquadAsync(scenario.SquadName, scenario.OwnerName, ownerUserId, clock);
            var historyMembershipId = await AddRegisteredMemberAsync(squadId, historyUserId, scenario.SecondName, clock);
            var noHistoryMembershipId = await AddRegisteredMemberAsync(squadId, noHistoryUserId, scenario.ThirdName, clock);

            var probe = new ConfigurableMembershipHistoryProbe();
            probe.MarkHasHistory(historyMembershipId); // the other is left with no history

            // --- Erase the history-bearing membership: expect anonymise-and-retain. ---
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                await new EraseMembershipHandler(
                        new EfSquadMembershipRepository(context),
                        new EfSquadRepository(context),
                        probe,
                        new UnitOfWork(context))
                    .HandleAsync(new EraseMembershipCommand(historyMembershipId), CancellationToken.None);
            }

            // --- Erase the no-history membership: expect permanent removal. ---
            await using (var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString())))
            {
                await new EraseMembershipHandler(
                        new EfSquadMembershipRepository(context),
                        new EfSquadRepository(context),
                        probe,
                        new UnitOfWork(context))
                    .HandleAsync(new EraseMembershipCommand(noHistoryMembershipId), CancellationToken.None);
            }

            bool anonymisedHolds;
            bool freedNameHolds;
            await using (var verify = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var anonymised = await verify.Set<SquadMembership>()
                    .IgnoreQueryFilters()
                    .FirstOrDefaultAsync(m => m.Id == historyMembershipId);

                anonymisedHolds = anonymised is not null
                    && anonymised.DisplayName == SquadMembership.DisplayNamePlaceholder
                    && anonymised.DisplayNameNormalized is null
                    && anonymised.UserId is null
                    && anonymised.Role is null;

                // The former name is freed for reuse (excluded from the uniqueness comparison).
                var takenName = scenario.SecondName.Trim().ToLowerInvariant();
                freedNameHolds = !await new EfSquadMembershipRepository(verify).DisplayNameTakenAsync(
                    squadId, takenName, excludingMembershipId: null, CancellationToken.None);
            }

            bool removedHolds;
            await using (var verify = CreateContext(clock, new FakeCurrentUserAccessor()))
            {
                var removed = await verify.Set<SquadMembership>()
                    .IgnoreQueryFilters()
                    .FirstOrDefaultAsync(m => m.Id == noHistoryMembershipId);
                removedHolds = removed is null;
            }

            return anonymisedHolds && freedNameHolds && removedHolds;
        });
    }

    // --- Helpers ---

    /// <summary>Builds a production <see cref="PitchMateDbContext"/> bound to the migrated test database.</summary>
    private PitchMateDbContext CreateContext(TimeProvider clock, ICurrentUserAccessor actor) =>
        new(MigrationTestSupport.BuildContextOptions(EnsureMigratedDatabaseAsync().GetAwaiter().GetResult()), clock, actor);

    /// <summary>Creates a squad and its owner through the real <see cref="CreateSquadHandler"/>.</summary>
    private async Task<(Guid SquadId, Guid OwnerMembershipId)> CreateSquadAsync(
        string squadName, string ownerName, Guid ownerUserId, TimeProvider clock)
    {
        await using var context = CreateContext(clock, new FakeCurrentUserAccessor(ownerUserId.ToString()));
        var handler = new CreateSquadHandler(
            new EfSquadRepository(context),
            new EfSquadMembershipRepository(context),
            new StubUserRepository(),
            new UnitOfWork(context));

        var result = await handler.HandleAsync(
            new CreateSquadCommand(ownerUserId, squadName, ownerName), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Message);
        return (result.Value!.SquadId, result.Value!.OwnerMembershipId);
    }

    /// <summary>
    /// Persists an active registered <see cref="SquadRole.Member"/> directly (there is no
    /// add-member handler outside invite redemption), for use as a transfer/leave/removal/erasure target.
    /// </summary>
    private async Task<Guid> AddRegisteredMemberAsync(Guid squadId, Guid userId, string displayName, TimeProvider clock)
    {
        await using var context = CreateContext(clock, new FakeCurrentUserAccessor(userId.ToString()));
        var memberships = new EfSquadMembershipRepository(context);
        var unitOfWork = new UnitOfWork(context);

        var membership = SquadMembership.CreateRegistered(squadId, userId, displayName).Value!;
        await memberships.AddAsync(membership, CancellationToken.None);
        await unitOfWork.SaveChangesAsync(CancellationToken.None);
        return membership.Id;
    }

    private DeleteSquadHandler BuildDeleteHandler(PitchMateDbContext context, TimeProvider clock) =>
        new(
            new EfSquadMembershipRepository(context),
            new EfSquadRepository(context),
            new EfRepository<Squad>(context),
            new UnitOfWork(context),
            clock);

    /// <summary>Counts the memberships currently holding the <see cref="SquadRole.Owner"/> role in a squad.</summary>
    private async Task<int> CountOwnersAsync(Guid squadId)
    {
        await using var context = CreateContext(new FakeTimeProvider(), new FakeCurrentUserAccessor());
        return await context.Set<SquadMembership>()
            .CountAsync(m => m.SquadId == squadId && m.Role == SquadRole.Owner);
    }

    /// <summary>Reloads a membership by identity in a fresh context (memberships are never soft-deleted).</summary>
    private async Task<SquadMembership?> GetMembershipAsync(Guid membershipId)
    {
        await using var context = CreateContext(new FakeTimeProvider(), new FakeCurrentUserAccessor());
        return await context.Set<SquadMembership>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(m => m.Id == membershipId);
    }

    /// <summary>Reads a squad through the default (soft-delete-filtered) path.</summary>
    private async Task<Squad?> GetSquadDefaultAsync(Guid squadId)
    {
        await using var context = CreateContext(new FakeTimeProvider(), new FakeCurrentUserAccessor());
        return await new EfSquadRepository(context).GetByIdAsync(squadId, CancellationToken.None);
    }

    /// <summary>Reads a squad bypassing the soft-delete filter.</summary>
    private async Task<Squad?> GetSquadIncludingDeletedAsync(Guid squadId)
    {
        await using var context = CreateContext(new FakeTimeProvider(), new FakeCurrentUserAccessor());
        return await new EfSquadRepository(context).GetByIdIncludingDeletedAsync(squadId, CancellationToken.None);
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the asynchronous database work each iteration
    /// performs. Blocking here is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock, and it surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
