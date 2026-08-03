using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
// PitchMate.Domain.Matches and PitchMate.Domain.Squads each define a Result<T>; import only the one
// Squads type this test needs via an alias so the unqualified Result<T> binds to the Matches triad.
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for the <see cref="SubmitAvailabilityResponseHandler"/> use case
/// (match-lifecycle design Property 6, Requirements 4.5 and 7.6). It drives the real handler against
/// hand-written in-memory fakes for <see cref="IMatchRepository"/>,
/// <see cref="ISquadMembershipRepository"/>, and <see cref="IAvailabilityRepository"/>, a controllable
/// <see cref="FakeTimeProvider"/>, and a Unit-of-Work fake that models the commit boundary, per the
/// Application-layer testing strategy (no database).
/// <para>
/// Property 6: for any actor, submitting an availability response succeeds <em>iff</em> the actor is
/// an active registered membership of the match's squad. An active registered member's submission
/// succeeds and its response is stored (an upsert is committed); a guest membership, an inactive
/// membership, or a non-member is rejected with the uniform <see cref="MatchErrorCode.Unauthorized"/>
/// failure and nothing is stored. The submitted days are always a subset of the match's candidate days
/// and the match is always gathering availability, so an active registered member never fails for a
/// non-authorisation reason — isolating the authorisation behaviour under test.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class AvailabilityAuthorisationPropertyTests
{
    /// <summary>The distinct kinds of actor the submit-availability handler can be presented with.</summary>
    public enum ActorKind
    {
        ActiveRegisteredOwner,
        ActiveRegisteredAdmin,
        ActiveRegisteredMember,
        InactiveRegisteredMember,
        ActiveGuest,
        InactiveGuest,
        NonMember
    }

    /// <summary>Which of the match's candidate days the actor marks as available.</summary>
    public enum MarkChoice
    {
        None,
        First,
        All
    }

    private static readonly DateTimeOffset Now =
        new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 6: Only active registered members may submit availability -
    // submitting an availability response succeeds iff the actor is an active registered membership of
    // the match's squad; an active registered member's response is stored, while a guest, an inactive
    // membership, or a non-member is rejected with the uniform Unauthorized failure and no response is
    // stored.
    // Validates: Requirements 4.5, 7.6
    [Property(MaxTest = 200)]
    [Trait("Property", "6")]
    public Property OnlyActiveRegisteredMembersMaySubmitAvailability() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<ActorKind>())),
            Arb.From(Gen.Elements(Enum.GetValues<MarkChoice>())),
            (actorKind, markChoice) =>
            {
                var world = World.Create(actorKind);
                IReadOnlyList<DateTimeOffset> markedDays = world.MarkedDays(markChoice);

                var command = new SubmitAvailabilityResponseCommand(world.ActingUserId, world.MatchId, markedDays);
                Result<AvailabilityResponse> result =
                    world.Handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();

                bool actorIsActiveRegistered = actorKind is ActorKind.ActiveRegisteredOwner
                    or ActorKind.ActiveRegisteredAdmin
                    or ActorKind.ActiveRegisteredMember;

                if (actorIsActiveRegistered)
                {
                    // Authorised: the submission succeeds and exactly one response is stored for the actor.
                    return result.IsSuccess
                        && world.Availability.StoredResponseCount == 1
                        && world.Availability.HasStoredFor(world.ActingMembershipId!.Value);
                }

                // Guest, inactive, or non-member: uniform Unauthorized failure and nothing stored.
                return !result.IsSuccess
                    && result.Error!.Code == MatchErrorCode.Unauthorized
                    && world.Availability.StoredResponseCount == 0;
            });

    /// <summary>
    /// Assembles the handler, its fakes, and a match gathering availability, together with an acting
    /// membership shaped to the requested <see cref="ActorKind"/>. The match carries three future
    /// candidate days so the actor can mark any subset of them.
    /// </summary>
    private sealed class World
    {
        private readonly IReadOnlyList<DateTimeOffset> _candidateDays;

        private World(
            SubmitAvailabilityResponseHandler handler,
            FakeAvailabilityRepository availability,
            Guid actingUserId,
            Guid? actingMembershipId,
            Guid matchId,
            IReadOnlyList<DateTimeOffset> candidateDays)
        {
            Handler = handler;
            Availability = availability;
            ActingUserId = actingUserId;
            ActingMembershipId = actingMembershipId;
            MatchId = matchId;
            _candidateDays = candidateDays;
        }

        public SubmitAvailabilityResponseHandler Handler { get; }

        public FakeAvailabilityRepository Availability { get; }

        public Guid ActingUserId { get; }

        /// <summary>The acting membership's identity, or <see langword="null"/> for a non-member.</summary>
        public Guid? ActingMembershipId { get; }

        public Guid MatchId { get; }

        public static World Create(ActorKind actorKind)
        {
            var squadId = Guid.NewGuid();
            var actingUserId = Guid.NewGuid();

            var candidateDays = new List<DateTimeOffset>
            {
                Now.AddDays(1),
                Now.AddDays(2),
                Now.AddDays(3),
            };

            Match match = Match.CreateDraft(Guid.NewGuid(), squadId, "Recreation Ground", candidateDays, Now).Value!;

            SquadMembership? acting = BuildActingMembership(actorKind, squadId, actingUserId);

            var matches = new FakeMatchRepository(match);
            var memberships = new FakeSquadMembershipRepository(actingUserId, squadId, acting);
            var availability = new FakeAvailabilityRepository();
            var unitOfWork = new FakeUnitOfWork(availability);
            var clock = new FakeTimeProvider(Now);

            var handler = new SubmitAvailabilityResponseHandler(matches, memberships, availability, unitOfWork, clock);

            return new World(handler, availability, actingUserId, acting?.Id, match.Id, candidateDays);
        }

        /// <summary>Resolves the marked candidate-day subset for the chosen <see cref="MarkChoice"/>.</summary>
        public IReadOnlyList<DateTimeOffset> MarkedDays(MarkChoice choice) => choice switch
        {
            MarkChoice.None => [],
            MarkChoice.First => [_candidateDays[0]],
            MarkChoice.All => _candidateDays.ToList(),
            _ => throw new ArgumentOutOfRangeException(nameof(choice), choice, "Unhandled mark choice."),
        };

        private static SquadMembership? BuildActingMembership(ActorKind actorKind, Guid squadId, Guid userId)
        {
            switch (actorKind)
            {
                case ActorKind.NonMember:
                    return null;

                case ActorKind.ActiveRegisteredOwner:
                    return SquadMembership.CreateOwner(squadId, userId, "Owner").Value!;

                case ActorKind.ActiveRegisteredAdmin:
                    SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, "Admin").Value!;
                    admin.PromoteToAdmin();
                    return admin;

                case ActorKind.ActiveRegisteredMember:
                    return SquadMembership.CreateRegistered(squadId, userId, "Member").Value!;

                case ActorKind.InactiveRegisteredMember:
                    SquadMembership inactive = SquadMembership.CreateRegistered(squadId, userId, "Member").Value!;
                    inactive.Deactivate();
                    return inactive;

                case ActorKind.ActiveGuest:
                    return SquadMembership.CreateGuest(squadId, "Guest", skillTier: null, Now).Value!;

                case ActorKind.InactiveGuest:
                    SquadMembership inactiveGuest = SquadMembership.CreateGuest(squadId, "Guest", skillTier: null, Now).Value!;
                    inactiveGuest.Deactivate();
                    return inactiveGuest;

                default:
                    throw new ArgumentOutOfRangeException(nameof(actorKind), actorKind, "Unhandled actor kind.");
            }
        }
    }

    /// <summary>In-memory <see cref="IMatchRepository"/> serving a single seeded match by identity.</summary>
    private sealed class FakeMatchRepository : IMatchRepository
    {
        private readonly Match _match;

        public FakeMatchRepository(Match match) => _match = match;

        public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_match.Id == matchId ? _match : null);
        }

        public Task AddAsync(Match match, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// In-memory <see cref="ISquadMembershipRepository"/> that resolves the single seeded acting
    /// membership when queried for the matching user and squad, and <see langword="null"/> otherwise
    /// (modelling a non-member). Only the resolution the handler uses is implemented.
    /// </summary>
    private sealed class FakeSquadMembershipRepository : ISquadMembershipRepository
    {
        private readonly Guid _userId;
        private readonly Guid _squadId;
        private readonly SquadMembership? _acting;

        public FakeSquadMembershipRepository(Guid userId, Guid squadId, SquadMembership? acting)
        {
            _userId = userId;
            _squadId = squadId;
            _acting = acting;
        }

        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SquadMembership? resolved = userId == _userId && squadId == _squadId ? _acting : null;
            return Task.FromResult(resolved);
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public void RemovePermanently(SquadMembership membership) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// In-memory <see cref="IAvailabilityRepository"/> modelling the Unit-of-Work boundary: an upsert
    /// only <em>stages</em> a response, which becomes committed when <see cref="Commit"/> runs on a
    /// successful save. Committed responses are keyed by membership so the test can assert exactly one
    /// stored response for the acting membership (or none on rejection).
    /// </summary>
    private sealed class FakeAvailabilityRepository : IAvailabilityRepository
    {
        private readonly Dictionary<Guid, AvailabilityResponse> _committed = new();
        private AvailabilityResponse? _staged;

        /// <summary>The number of committed responses stored.</summary>
        public int StoredResponseCount => _committed.Count;

        /// <summary>Whether a committed response exists for the given membership.</summary>
        public bool HasStoredFor(Guid squadMembershipId) => _committed.ContainsKey(squadMembershipId);

        public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ArgumentNullException.ThrowIfNull(response);
            _staged = response;
            return Task.CompletedTask;
        }

        /// <summary>Atomically commits the staged response, mirroring a successful unit-of-work save.</summary>
        public void Commit()
        {
            if (_staged is not null)
            {
                _committed[_staged.SquadMembershipId] = _staged;
                _staged = null;
            }
        }

        public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_committed.GetValueOrDefault(squadMembershipId));
        }

        public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    /// <summary>A fake <see cref="IUnitOfWork"/> that commits the staged availability response on save.</summary>
    private sealed class FakeUnitOfWork : IUnitOfWork
    {
        private readonly FakeAvailabilityRepository _availability;

        public FakeUnitOfWork(FakeAvailabilityRepository availability) => _availability = availability;

        public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _availability.Commit();
            return Task.FromResult(1);
        }
    }
}
