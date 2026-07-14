using System.Text.Json;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for <see cref="ExportSquadHandler"/> focused on the export payload
/// (Requirement 17.2): the active owner of a <em>soft-deleted</em> squad receives an export — loaded
/// including-deleted so it remains available while the squad is pending purge — that carries every
/// membership (active and inactive), every invite projected to its effective state with the creation
/// audit but <b>no</b> redeemable secret (the persisted one-way token hash is never surfaced), and
/// every <see cref="SquadFeature"/> with its current state.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class ExportSquadHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 1, 12, 0, 0, TimeSpan.Zero);

    // Distinctive one-way token hashes seeded on the invites so a payload leak of the redeemable
    // secret would be detectable in the serialised export.
    private const string ActiveInviteTokenHash = "hash::active-redeemable-secret";
    private const string RevokedInviteTokenHash = "hash::revoked-redeemable-secret";

    private sealed class Harness
    {
        public required SquadStore Store { get; init; }
        public required ExportSquadHandler Handler { get; init; }
        public required Squad Squad { get; init; }

        /// <summary>
        /// Builds a soft-deleted squad (reachable only via the including-deleted load) populated with
        /// an active owner, an inactive registered member, a guest, an active and a revoked invite,
        /// and one enabled feature, returning the owner's user id.
        /// </summary>
        public static (Harness Harness, Guid OwnerUserId) CreateSoftDeletedWithData()
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;

            // Record the purge instant and route the squad through the deleted-only store so an export
            // that used the non-deleted load would fail to find it (Requirement 17.2).
            DateTimeOffset purgeAt = Now.AddDays(Squad.DefaultGracePeriodDays);
            squad.MarkForDeletion(purgeAt);
            store.AddCommittedSquad(squad, softDeleted: true);

            var handler = new ExportSquadHandler(
                new FakeSquadMembershipRepository(store),
                new FakeSquadRepository(store),
                new FakeInviteRepository(store, new SquadFakeClock(Now)),
                new SquadFakeClock(Now));

            var harness = new Harness { Store = store, Handler = handler, Squad = squad };

            // Active owner (the requester); soft-deleting a squad does not deactivate memberships.
            Guid ownerUserId = Guid.NewGuid();
            store.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

            // An inactive registered member and a guest so the export spans active and inactive.
            SquadMembership inactive =
                SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Ghost").Value!;
            inactive.Deactivate();
            store.AddCommittedMembership(inactive);
            store.AddCommittedMembership(
                SquadMembership.CreateGuest(squad.Id, "Dave", skillTier: null, Now).Value!);

            // One active (non-expiring) invite and one revoked invite, each with a distinct token hash.
            store.AddCommittedInvite(Invite.Create(squad.Id, ActiveInviteTokenHash, expiresAt: null));
            Invite revoked = Invite.Create(squad.Id, RevokedInviteTokenHash, expiresAt: null);
            revoked.Revoke();
            store.AddCommittedInvite(revoked);

            squad.SetFeature(SquadFeature.LiveMatchTracking, true);

            return (harness, ownerUserId);
        }
    }

    private static async Task<SquadExport> ExportAsync(Harness harness, Guid ownerUserId)
    {
        Result<SquadExport> result = await harness.Handler.HandleAsync(
            new ExportSquadCommand(ownerUserId, harness.Squad.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
        return result.Value!;
    }

    [Fact]
    public async Task Owner_ExportsSoftDeletedSquad_LoadedIncludingDeleted()
    {
        (Harness harness, Guid ownerUserId) = Harness.CreateSoftDeletedWithData();

        // Succeeding at all proves the squad was loaded including-deleted: it is reachable only via the
        // deleted-only store, so a non-deleted load would have yielded the uniform failure.
        SquadExport export = await ExportAsync(harness, ownerUserId);

        Assert.Equal(harness.Squad.Id, export.SquadId);
        Assert.Equal("The Squad", export.Name);
        Assert.Equal(Now.AddDays(Squad.DefaultGracePeriodDays), export.PurgeAt);
    }

    [Fact]
    public async Task Export_ContainsEveryMembership_ActiveAndInactive()
    {
        (Harness harness, Guid ownerUserId) = Harness.CreateSoftDeletedWithData();

        SquadExport export = await ExportAsync(harness, ownerUserId);

        Assert.Equal(3, export.Memberships.Count);
        Assert.Contains(export.Memberships, m => m.Role == SquadRole.Owner && m.State == MembershipState.Active);
        Assert.Contains(export.Memberships, m => m.DisplayName == "Ghost" && m.State == MembershipState.Inactive);
        Assert.Contains(export.Memberships, m => m.IsGuest && m.DisplayName == "Dave");
    }

    [Fact]
    public async Task Export_ContainsEveryInvite_ProjectedToItsEffectiveState()
    {
        (Harness harness, Guid ownerUserId) = Harness.CreateSoftDeletedWithData();

        SquadExport export = await ExportAsync(harness, ownerUserId);

        Assert.Equal(2, export.Invites.Count);
        Assert.Contains(export.Invites, i => i.State == InviteState.Active && i.ExpiresAt is null);
        Assert.Contains(export.Invites, i => i.State == InviteState.Revoked);
    }

    [Fact]
    public async Task Export_ContainsEveryFeatureFlagWithItsCurrentState()
    {
        (Harness harness, Guid ownerUserId) = Harness.CreateSoftDeletedWithData();

        SquadExport export = await ExportAsync(harness, ownerUserId);

        Assert.Equal(Enum.GetValues<SquadFeature>().Length, export.Features.Count);
        Assert.Contains(export.Features, f => f.Feature == SquadFeature.LiveMatchTracking && f.IsEnabled);
    }

    [Fact]
    public async Task Export_ExcludesAnyRedeemableSecret_NoTokenHashSurfaced()
    {
        (Harness harness, Guid ownerUserId) = Harness.CreateSoftDeletedWithData();

        SquadExport export = await ExportAsync(harness, ownerUserId);

        // The whole payload — invites included — must carry nothing from which the redeemable secret
        // can be reconstructed; the persisted one-way token hash is never surfaced (Requirement 17.2).
        string json = JsonSerializer.Serialize(export);
        Assert.DoesNotContain(ActiveInviteTokenHash, json, StringComparison.Ordinal);
        Assert.DoesNotContain(RevokedInviteTokenHash, json, StringComparison.Ordinal);
        Assert.DoesNotContain("hash::", json, StringComparison.Ordinal);
    }
}
