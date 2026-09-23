using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// A notification read surface whose two counting reads report whatever the test asks them to, so the
/// named-envelope guard can drive the real unread-count and mark-all-read endpoints end to end —
/// through routing, authentication, the real Application handlers, and the real minimal-API
/// serialiser — for any non-negative count, without a database behind it.
/// <para>
/// Only the two reads those handlers consult are implemented. <see cref="UnreadCount"/> is what
/// <see cref="CountUnreadForUserAsync"/> reports, so the unread-count envelope can be asserted for any
/// <see cref="int"/> the endpoint could ever carry. <see cref="UnreadRecordCount"/> is how many
/// <c>Unread</c> records <see cref="ListUnreadForUserAsync"/> hands back, which is the number the
/// mark-all-read handler flips and therefore the number its envelope reports — so that conjunct's count
/// is set by materialising that many records rather than by asserting one.
/// </para>
/// <para>
/// Every other member throws: reaching one would mean the guard is exercising something other than the
/// two envelopes under test, and a loud failure is better than a quiet one.
/// </para>
/// </summary>
internal sealed class StubbedCountNotificationRepository : INotificationRepository
{
    /// <summary>A fixed owning squad for the stubbed records. It resolves to no squad, and never needs to.</summary>
    private static readonly Guid StubSquadId = Guid.Parse("4c6e2a91-3b75-4d08-9f1c-2e5a7d0b8c43");

    /// <summary>A fixed recipient membership for the stubbed records. It backs no real membership.</summary>
    private static readonly Guid StubMembershipId = Guid.Parse("b71d5f3a-0e48-42c9-8a6b-9d3c1f70e254");

    /// <summary>The unread count <see cref="CountUnreadForUserAsync"/> reports.</summary>
    public int UnreadCount { get; set; }

    /// <summary>The number of <c>Unread</c> records <see cref="ListUnreadForUserAsync"/> hands back.</summary>
    public int UnreadRecordCount { get; set; }

    /// <inheritdoc />
    public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        Task.FromResult(UnreadCount);

    /// <inheritdoc />
    public Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(
        Guid userId, Guid? squadId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<InAppNotification>>(CreateUnreadRecords(UnreadRecordCount));

    /// <summary>
    /// Reports that the caller holds a membership. The guard never scopes a request to a squad, so this
    /// is not consulted on the paths under test; it answers rather than throws only so that a squad
    /// scope added to the guard later fails on the envelope rather than on a stub.
    /// </summary>
    /// <inheritdoc />
    public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct) =>
        Task.FromResult(true);

    /// <summary>Builds <paramref name="count"/> freshly-created (and therefore <c>Unread</c>) records.</summary>
    private static InAppNotification[] CreateUnreadRecords(int count) =>
    [
        .. Enumerable.Range(0, count).Select(static _ => InAppNotification.Create(
            StubSquadId,
            StubMembershipId,
            NotificationType.MemberJoined,
            "Stubbed notification",
            "A record the named-envelope guard marks read.").Value!),
    ];

    /// <inheritdoc />
    public Task AddAsync(InAppNotification notification, CancellationToken ct) => throw NotUnderTest();

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct) =>
        throw NotUnderTest();

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(
        Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct) => throw NotUnderTest();

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(
        Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct) => throw NotUnderTest();

    /// <inheritdoc />
    public Task<IReadOnlyList<InAppNotification>> ListForUserAsync(
        Guid userId, Guid? squadId, int limit, CancellationToken ct) => throw NotUnderTest();

    /// <inheritdoc />
    public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct) =>
        throw NotUnderTest();

    /// <inheritdoc />
    public Task RemoveForUserAsync(Guid userId, CancellationToken ct) => throw NotUnderTest();

    /// <inheritdoc />
    public Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct) => throw NotUnderTest();

    /// <inheritdoc />
    public Task RemoveForSquadAsync(Guid squadId, CancellationToken ct) => throw NotUnderTest();

    private static InvalidOperationException NotUnderTest() =>
        new("The named-envelope guard drives only the unread-count and mark-all-read reads.");
}
