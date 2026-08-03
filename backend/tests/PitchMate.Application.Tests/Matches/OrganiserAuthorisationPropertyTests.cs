using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
// PitchMate.Domain.Matches, PitchMate.Domain.Rating, and PitchMate.Domain.Squads each define a
// Result / Result<T> triad. Keep the Matches namespace imported so the unqualified MatchError /
// MatchErrorCode / Result the handlers return bind to the Matches triad, and pull in the specific
// rating and squad types this test needs by alias (mirroring the completion handler and the sibling
// completion/team-rolling fakes) so nothing is confused with it.
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using MembershipState = PitchMate.Domain.Squads.MembershipState;
using Squad = PitchMate.Domain.Squads.Squad;
using MatchErrorCode = PitchMate.Domain.Matches.MatchErrorCode;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using RatingMatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using RatingMatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for organiser authorisation across every match-organising use case
/// (match-lifecycle design Property 19, Requirements 1.2, 6.7, 14.1, 14.2, 15.4). It drives the real
/// organising-action handlers — create draft, confirm, add/remove participant, propose/adjust/lock
/// teams, start, record result, complete, and cancel — against hand-written in-memory fakes: match,
/// membership, availability, membership-rating, snapshot, and squad repositories; a controllable
/// <see cref="FakeTimeProvider"/>; a recording <see cref="INotificationPublisher"/>; and stub
/// <see cref="IRatingEngine"/> / <see cref="ITeamBalancer"/> — per the Application-layer testing
/// strategy (no database). Each handler is presented with the match's owning squad in exactly the
/// lifecycle state in which the action would otherwise succeed, isolating the authorisation behaviour.
/// <para>
/// Property 19: for any organising action and any actor, the action is permitted <em>iff</em> the
/// actor holds an active registered <see cref="PitchMate.Domain.Squads.SquadRole.Owner"/> or
/// <see cref="PitchMate.Domain.Squads.SquadRole.Admin"/> membership in the match's squad; an active
/// owner or admin succeeds, while every other actor — a plain member, an inactive owner/admin/member,
/// a guest, an inactive guest, or a non-member — is rejected with a single uniform
/// <see cref="MatchErrorCode.Unauthorized"/> failure carrying the same non-disclosing message, so a
/// rejection never reveals the actor's role nor whether the squad or match exists and the match is
/// left unchanged. The property runs at least 100 iterations across every action × actor combination.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class OrganiserAuthorisationPropertyTests
{
    /// <summary>A fixed UTC anchor the fake clock reads from; the single candidate/confirmed day sits well after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The single, valid, strictly-future candidate/confirmed day of every built match.</summary>
    private static readonly DateTimeOffset Day = Anchor.AddDays(7);

    private const string Location = "Hackney Marshes, Pitch 12";

    /// <summary>
    /// The single, non-disclosing message every authorisation failure carries (mirrors
    /// <c>MatchAuthorization.UniformFailureMessage</c>). Asserting every rejection carries exactly this
    /// message — for every action and every unauthorised actor — is what proves the failure discloses
    /// neither the actor's role nor whether the squad or match exists (Requirement 14.1, 14.2, 15.4).
    /// </summary>
    private const string UniformFailureMessage = "The requested action is not permitted.";

    /// <summary>The number of participants seeded for the confirmed/rolled/completed match worlds (in range 10..16).</summary>
    private const int ParticipantCount = 10;

    /// <summary>The distinct kinds of actor an organising action can be presented with.</summary>
    public enum ActorKind
    {
        ActiveOwner,
        ActiveAdmin,
        ActiveMember,
        InactiveOwner,
        InactiveAdmin,
        InactiveMember,
        ActiveGuest,
        InactiveGuest,
        NonMember,
    }

    /// <summary>The match-organising actions gated by <c>MatchAuthorization.RequireOrganiser</c>.</summary>
    public enum OrganiserAction
    {
        CreateDraft,
        Confirm,
        AddParticipant,
        RemoveParticipant,
        ProposeTeams,
        AdjustTeams,
        LockTeams,
        StartMatch,
        RecordResult,
        CompleteMatch,
        CancelMatch,
    }

    // Feature: match-lifecycle, Property 19: Organising actions require an active owner or admin - for
    // any organising action (create draft, confirm, add/remove participant, roll/lock teams, start,
    // record result, complete, cancel) and any actor, the action is permitted iff the actor holds an
    // active registered Owner or Admin membership in the match's squad; every other actor (plain
    // member, inactive, guest, non-member) is rejected with a single uniform Unauthorized failure that
    // discloses no match data and leaves the match unchanged.
    // Validates: Requirements 1.2, 6.7, 14.1, 14.2, 15.4
    [Property(MaxTest = 300)]
    [Trait("Property", "19")]
    public Property OrganisingActionsRequireAnActiveOwnerOrAdmin() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<OrganiserAction>())),
            Arb.From(Gen.Elements(Enum.GetValues<ActorKind>())),
            (action, actorKind) =>
            {
                Outcome outcome = Invoke(action, actorKind);

                bool authorised = actorKind is ActorKind.ActiveOwner or ActorKind.ActiveAdmin;

                return authorised
                    // An active registered owner or admin is permitted: the action proceeds and succeeds.
                    ? outcome.Success
                    // Every other actor is rejected with the single uniform, non-disclosing failure.
                    : !outcome.Success
                        && outcome.Code == MatchErrorCode.Unauthorized
                        && outcome.Message == UniformFailureMessage;
            });

    /// <summary>The normalised outcome of an organising action: success, or a failure with its code and message.</summary>
    private readonly record struct Outcome(bool Success, MatchErrorCode? Code, string? Message);

    private static Outcome ToOutcome(bool success, MatchError? error) =>
        success ? new Outcome(true, null, null) : new Outcome(false, error!.Code, error.Message);

    /// <summary>
    /// Builds the world for <paramref name="action"/> with the acting membership shaped to
    /// <paramref name="actorKind"/>, runs the matching handler, and normalises its result. Every world
    /// stages the match in the exact state the action would otherwise succeed from, so an active owner
    /// or admin succeeds and any rejection is purely an authorisation rejection.
    /// </summary>
    private static Outcome Invoke(OrganiserAction action, ActorKind actorKind)
    {
        Guid squadId = Guid.NewGuid();
        Guid actingUserId = Guid.NewGuid();
        SquadMembership? acting = BuildActing(actorKind, squadId, actingUserId);

        return action switch
        {
            OrganiserAction.CreateDraft => InvokeCreateDraft(squadId, actingUserId, acting),
            OrganiserAction.Confirm => InvokeConfirm(squadId, actingUserId, acting),
            OrganiserAction.AddParticipant => InvokeAddParticipant(squadId, actingUserId, acting),
            OrganiserAction.RemoveParticipant => InvokeRemoveParticipant(squadId, actingUserId, acting),
            OrganiserAction.ProposeTeams => InvokeProposeTeams(squadId, actingUserId, acting),
            OrganiserAction.AdjustTeams => InvokeAdjustTeams(squadId, actingUserId, acting),
            OrganiserAction.LockTeams => InvokeLockTeams(squadId, actingUserId, acting),
            OrganiserAction.StartMatch => InvokeStartMatch(squadId, actingUserId, acting),
            OrganiserAction.RecordResult => InvokeRecordResult(squadId, actingUserId, acting),
            OrganiserAction.CompleteMatch => InvokeCompleteMatch(squadId, actingUserId, acting),
            OrganiserAction.CancelMatch => InvokeCancelMatch(squadId, actingUserId, acting),
            _ => throw new ArgumentOutOfRangeException(nameof(action), action, "Unhandled organising action."),
        };
    }

    // ---- Per-action worlds ----------------------------------------------------------------------

    private static Outcome InvokeCreateDraft(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        var handler = new CreateMatchDraftHandler(
            new FakeMatchRepository(match: null),
            new FakeMembershipRepository(actingUserId, squadId, acting),
            new FakeSquadRepository(),
            new FakeUnitOfWork(),
            new FakeTimeProvider(Anchor),
            new FakePublisher(),
            NullLogger<CreateMatchDraftHandler>.Instance);

        var result = handler
            .HandleAsync(new CreateMatchDraftCommand(actingUserId, squadId, Location, [Day]), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeConfirm(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        // A gathering-availability match with ParticipantCount active registered members each marking
        // the confirmed day, so the available count meets the default threshold of 10.
        Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, Location, [Day], Anchor).Value!;
        var members = new List<SquadMembership>(ParticipantCount);
        for (int i = 0; i < ParticipantCount; i++)
        {
            SquadMembership member = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!;
            match.SubmitAvailability(member.Id, [Day], Anchor);
            members.Add(member);
        }

        var handler = new ConfirmMatchHandler(
            new FakeMatchRepository(match),
            new FakeAvailabilityRepository([.. match.AvailabilityResponses]),
            new FakeMembershipRepository(actingUserId, squadId, acting, members),
            new FakeSquadRepository(),
            new FakeUnitOfWork(),
            new FakePublisher(),
            NullLogger<ConfirmMatchHandler>.Instance);

        var result = handler
            .HandleAsync(new ConfirmMatchCommand(actingUserId, match.Id, Day), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeAddParticipant(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, _) = BuildConfirmed(squadId);

        // An active guest of the squad, resolvable by id, that is not yet a participant.
        SquadMembership guest = SquadMembership.CreateGuest(squadId, "Guest To Add", skillTier: null, Anchor).Value!;

        var handler = new AddGuestParticipantHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, [guest]),
            new FakeUnitOfWork());

        var result = handler
            .HandleAsync(new AddGuestParticipantCommand(actingUserId, match.Id, guest.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeRemoveParticipant(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildConfirmed(squadId);

        var handler = new RemoveParticipantHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeUnitOfWork());

        var result = handler
            .HandleAsync(
                new RemoveParticipantCommand(actingUserId, match.Id, participants[0].Id),
                CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeProposeTeams(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildConfirmed(squadId);

        var handler = new ProposeTeamsHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeMembershipRatingRepository(),
            new StubRatingEngine(),
            new StubTeamBalancer());

        var result = handler
            .HandleAsync(new ProposeTeamsCommand(actingUserId, match.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeAdjustTeams(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildWithWorkingTeams(squadId);
        Guid teamId = match.Teams.First().Id;

        var handler = new AdjustTeamsHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeMembershipRatingRepository(),
            new StubRatingEngine(),
            new StubTeamBalancer(),
            new StubSillyNameGenerator(),
            new FakeUnitOfWork());

        // Choosing the single bib-wearing team is a valid edit on the working teams and touches neither
        // the balancer nor the rating engine, isolating the organiser gate.
        var result = handler
            .HandleAsync(
                new AdjustTeamsCommand(actingUserId, match.Id, new TeamAdjustment.SetBibTeam(teamId)),
                CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeLockTeams(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildWithWorkingTeams(squadId);

        var handler = new LockTeamsHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeSquadRepository(),
            new FakeUnitOfWork(),
            new FakePublisher(),
            NullLogger<LockTeamsHandler>.Instance);

        var result = handler
            .HandleAsync(new LockTeamsCommand(actingUserId, match.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeStartMatch(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildLocked(squadId);

        var handler = new StartMatchHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeUnitOfWork());

        var result = handler
            .HandleAsync(new StartMatchCommand(actingUserId, match.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeRecordResult(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildInProgress(squadId);
        List<MatchTeam> teams = match.Teams.ToList();
        var scores = new[]
        {
            new TeamScore(teams[0].Id, 3),
            new TeamScore(teams[1].Id, 1),
        };

        var handler = new RecordResultHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeSquadRepository(),
            new FakeUnitOfWork());

        var result = handler
            .HandleAsync(
                new RecordResultCommand(actingUserId, match.Id, ResultFidelity.Basic, scores),
                CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeCompleteMatch(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildInProgress(squadId);

        // Record a result on the aggregate so the match is completable.
        List<MatchTeam> teams = match.Teams.ToList();
        match.RecordResult(
            new MatchResult(ResultFidelity.Basic, new[]
            {
                new TeamScore(teams[0].Id, 2),
                new TeamScore(teams[1].Id, 2),
            }),
            liveTrackingEnabled: false);

        var handler = new CompleteMatchHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRatingRepository(),
            new FakeSnapshotRepository(),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeSquadRepository(),
            new StubRatingEngine(),
            new FakeUnitOfWork(),
            new FakeTimeProvider(Anchor),
            new FakePublisher(),
            NullLogger<CompleteMatchHandler>.Instance);

        var result = handler
            .HandleAsync(new CompleteMatchCommand(actingUserId, match.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    private static Outcome InvokeCancelMatch(Guid squadId, Guid actingUserId, SquadMembership? acting)
    {
        (Match match, List<SquadMembership> participants) = BuildConfirmed(squadId);

        var handler = new CancelMatchHandler(
            new FakeMatchRepository(match),
            new FakeMembershipRepository(actingUserId, squadId, acting, participants),
            new FakeUnitOfWork());

        var result = handler
            .HandleAsync(new CancelMatchCommand(actingUserId, match.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

        return ToOutcome(result.IsSuccess, result.Error);
    }

    // ---- Match builders -------------------------------------------------------------------------

    /// <summary>Builds a Confirmed match with <see cref="ParticipantCount"/> registered participants and an empty seeded pool.</summary>
    private static (Match Match, List<SquadMembership> Participants) BuildConfirmed(Guid squadId)
    {
        Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, Location, [Day], Anchor).Value!;
        match.Confirm(Day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

        var participants = new List<SquadMembership>(ParticipantCount);
        for (int i = 0; i < ParticipantCount; i++)
        {
            SquadMembership member = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!;
            match.AddParticipant(member);
            participants.Add(member);
        }

        return (match, participants);
    }

    /// <summary>Builds a Confirmed match with two valid named working teams applied (still editable).</summary>
    private static (Match Match, List<SquadMembership> Participants) BuildWithWorkingTeams(Guid squadId)
    {
        (Match match, List<SquadMembership> participants) = BuildConfirmed(squadId);
        ApplyTwoTeams(match, participants);
        return (match, participants);
    }

    /// <summary>Builds a match locked into TeamsRolled with a captured kickoff lineup.</summary>
    private static (Match Match, List<SquadMembership> Participants) BuildLocked(Guid squadId)
    {
        (Match match, List<SquadMembership> participants) = BuildWithWorkingTeams(squadId);
        match.Lock();
        return (match, participants);
    }

    /// <summary>Builds a match in play (InProgress) with the kickoff lineup captured at lock.</summary>
    private static (Match Match, List<SquadMembership> Participants) BuildInProgress(Guid squadId)
    {
        (Match match, List<SquadMembership> participants) = BuildLocked(squadId);
        match.Start();
        return (match, participants);
    }

    /// <summary>Partitions the participants into two valid, distinctly named teams with a single bib team.</summary>
    private static void ApplyTwoTeams(Match match, List<SquadMembership> participants)
    {
        int half = participants.Count / 2;
        List<Guid> ids = participants.Select(p => p.Id).ToList();
        var teams = new List<ProposedTeam>
        {
            new("Reds", BibFlag: true, ids.Take(half).ToList()),
            new("Blues", BibFlag: false, ids.Skip(half).ToList()),
        };
        match.ApplyTeamProposal(teams);
    }

    // ---- Acting membership shaping --------------------------------------------------------------

    /// <summary>
    /// Builds the acting membership for <paramref name="actorKind"/> in <paramref name="squadId"/>,
    /// backed (for registered kinds) by <paramref name="actingUserId"/>, or <see langword="null"/> for
    /// a non-member. Only an active owner or admin should be permitted by the organiser gate.
    /// </summary>
    private static SquadMembership? BuildActing(ActorKind actorKind, Guid squadId, Guid actingUserId)
    {
        switch (actorKind)
        {
            case ActorKind.NonMember:
                return null;

            case ActorKind.ActiveOwner:
                return SquadMembership.CreateOwner(squadId, actingUserId, "Owner").Value!;

            case ActorKind.InactiveOwner:
                SquadMembership inactiveOwner = SquadMembership.CreateOwner(squadId, actingUserId, "Owner").Value!;
                inactiveOwner.Deactivate();
                return inactiveOwner;

            case ActorKind.ActiveAdmin:
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, actingUserId, "Admin").Value!;
                admin.PromoteToAdmin();
                return admin;

            case ActorKind.InactiveAdmin:
                SquadMembership inactiveAdmin = SquadMembership.CreateRegistered(squadId, actingUserId, "Admin").Value!;
                inactiveAdmin.PromoteToAdmin();
                inactiveAdmin.Deactivate();
                return inactiveAdmin;

            case ActorKind.ActiveMember:
                return SquadMembership.CreateRegistered(squadId, actingUserId, "Member").Value!;

            case ActorKind.InactiveMember:
                SquadMembership inactiveMember = SquadMembership.CreateRegistered(squadId, actingUserId, "Member").Value!;
                inactiveMember.Deactivate();
                return inactiveMember;

            case ActorKind.ActiveGuest:
                return SquadMembership.CreateGuest(squadId, "Guest", skillTier: null, Anchor).Value!;

            case ActorKind.InactiveGuest:
                SquadMembership inactiveGuest = SquadMembership.CreateGuest(squadId, "Guest", skillTier: null, Anchor).Value!;
                inactiveGuest.Deactivate();
                return inactiveGuest;

            default:
                throw new ArgumentOutOfRangeException(nameof(actorKind), actorKind, "Unhandled actor kind.");
        }
    }

    // ---- Fakes ----------------------------------------------------------------------------------

    /// <summary>
    /// In-memory <see cref="IMatchRepository"/> serving an optional single match by identity (also on
    /// the completion concurrency-reload path) and accepting a staged add for draft creation. The
    /// listing members are unused by the organising handlers under test and throw if called.
    /// </summary>
    private sealed class FakeMatchRepository(Match? match) : IMatchRepository
    {
        public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(match is not null && match.Id == matchId ? match : null);
        }

        public Task AddAsync(Match match, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadMembershipRepository"/> that resolves the acting membership by backing
    /// user and squad (the organiser gate), lists the squad's members (for the confirm/propose/complete
    /// paths), and resolves a member by id (for the add-guest path). Every other member is unused by the
    /// handlers under test and throws if called.
    /// </summary>
    private sealed class FakeMembershipRepository : ISquadMembershipRepository
    {
        private readonly Guid _actingUserId;
        private readonly Guid _squadId;
        private readonly SquadMembership? _acting;
        private readonly IReadOnlyList<SquadMembership> _squadMembers;

        public FakeMembershipRepository(
            Guid actingUserId,
            Guid squadId,
            SquadMembership? acting,
            IReadOnlyList<SquadMembership>? squadMembers = null)
        {
            _actingUserId = actingUserId;
            _squadId = squadId;
            _acting = acting;
            _squadMembers = squadMembers ?? [];
        }

        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            // The acting membership is resolved by the acting user and the match's squad, mirroring how
            // the real edge maps the access-token subject to a membership; a guest actor is modelled by
            // resolving the acting user to a guest membership even though a guest holds no backing user.
            SquadMembership? resolved = userId == _actingUserId && squadId == _squadId ? _acting : null;
            return Task.FromResult(resolved);
        }

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IReadOnlyList<SquadMembership> result = _squadMembers
                .Where(m => m.SquadId == squadId && (!activeOnly || m.State == MembershipState.Active))
                .ToList();
            return Task.FromResult(result);
        }

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_squadMembers.FirstOrDefault(m => m.Id == membershipId));
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public void RemovePermanently(SquadMembership membership) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");
    }

    /// <summary>In-memory <see cref="IAvailabilityRepository"/> returning a fixed set of stored responses for the confirm path.</summary>
    private sealed class FakeAvailabilityRepository(IReadOnlyList<AvailabilityResponse> responses) : IAvailabilityRepository
    {
        public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(responses);
        }

        public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadRepository"/> that returns <see langword="null"/> for the squad
    /// lookup — sufficient for the organising handlers, which only read it for notification rendering
    /// (a null squad renders an empty name) and for the live-tracking flag (a null squad reads as
    /// disabled, so the basic result recorded here is always accepted). Every other member throws.
    /// </summary>
    private sealed class FakeSquadRepository : ISquadRepository
    {
        public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<Squad?>(null);
        }

        public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public void RemovePermanently(Squad squad) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");
    }

    /// <summary>
    /// In-memory <see cref="IMembershipRatingRepository"/> that returns a fixed established rating for
    /// every membership, so the balance-request factory and the completion handler read a current
    /// rating and never seed one from the engine. The staging member accepts inserts as a no-op.
    /// </summary>
    private sealed class FakeMembershipRatingRepository : IMembershipRatingRepository
    {
        private static readonly PlayerRating Neutral = new(25.0, 3.0);

        public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<MembershipRating?>(MembershipRating.Create(squadMembershipId, Neutral));
        }

        public Task AddAsync(MembershipRating rating, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }
    }

    /// <summary>In-memory <see cref="IRepository{RatingSnapshot}"/> that accepts snapshot inserts as a no-op; the rest throw.</summary>
    private sealed class FakeSnapshotRepository : IRepository<RatingSnapshot>
    {
        public Task AddAsync(RatingSnapshot entity, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }

        public Task<RatingSnapshot?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<IReadOnlyList<RatingSnapshot>> ListAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public Task<IReadOnlyList<RatingSnapshot>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public void Remove(RatingSnapshot entity) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public void Restore(RatingSnapshot entity) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");
    }

    /// <summary>A minimal <see cref="IUnitOfWork"/> that commits successfully.</summary>
    private sealed class FakeUnitOfWork : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(1);
        }
    }

    /// <summary>A no-op <see cref="INotificationPublisher"/> that returns success for every publish.</summary>
    private sealed class FakePublisher : INotificationPublisher
    {
        public Task<NotifResult> PublishAsync(
            NotificationType type,
            Guid squadId,
            IReadOnlyCollection<Guid> directedTargetMembershipIds,
            NotificationContext context,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(NotifResult.Ok());
        }
    }

    /// <summary>
    /// A stub <see cref="ITeamBalancer"/> that splits the offered participants into two equal-ish teams.
    /// The propose handler returns this proposal to the caller unchanged; the split need only be
    /// well-formed for the authorised path to succeed.
    /// </summary>
    private sealed class StubTeamBalancer : ITeamBalancer
    {
        public Task<PitchMate.Domain.Matches.Result<TeamProposal>> ProposeAsync(
            TeamBalanceRequest request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            List<Guid> ids = request.Participants.Select(p => p.SquadMembershipId).ToList();
            int half = ids.Count / 2;
            var teams = new List<ProposedTeamAssignment>
            {
                new(ids.Take(half).ToList(), WinProbability: 0.5),
                new(ids.Skip(half).ToList(), WinProbability: 0.5),
            };

            return Task.FromResult(
                PitchMate.Domain.Matches.Result<TeamProposal>.Ok(new TeamProposal(teams, DrawProbability: 0.0)));
        }
    }

    /// <summary>A stub <see cref="ISillyNameGenerator"/> returning a fixed non-empty name; unused by the SetBibTeam adjustment.</summary>
    private sealed class StubSillyNameGenerator : ISillyNameGenerator
    {
        public string Next() => "Generated Silly Name";
    }

    /// <summary>
    /// A stub <see cref="IRatingEngine"/> for the completion path: it seeds a fixed cold-start rating
    /// and, for <see cref="UpdateRatings"/>, mirrors the outcome's team-and-player ordering exactly so
    /// the completion handler maps the output back onto the kickoff lineup. The remaining operations are
    /// unused by the organising handlers and throw if called.
    /// </summary>
    private sealed class StubRatingEngine : IRatingEngine
    {
        public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
            PitchMate.Domain.Rating.Result<PlayerRating>.Ok(new PlayerRating(25.0, 8.333));

        public PitchMate.Domain.Rating.Result<RatingMatchUpdate> UpdateRatings(RatingMatchOutcome outcome)
        {
            IReadOnlyList<IReadOnlyList<PlayerRating>> teams = outcome.Teams
                .Select(team => (IReadOnlyList<PlayerRating>)team.Players
                    .Select(p => new PlayerRating(p.Rating.Mu + 1.0, p.Rating.Sigma))
                    .ToList())
                .ToList();

            return PitchMate.Domain.Rating.Result<RatingMatchUpdate>.Ok(new RatingMatchUpdate(teams));
        }

        public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
            IReadOnlyList<PlayerRating> initialRatings,
            IReadOnlyList<ReplayMatch> matches) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");

        public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
            throw new NotSupportedException("Not exercised by the organising handlers under test.");
    }
}
