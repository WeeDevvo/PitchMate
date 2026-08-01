using PitchMate.Domain.Common;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The aggregate root representing a single game within one squad. A match is drafted by an
/// admin with a location and a set of candidate days, then walks the lifecycle
/// <see cref="MatchState.GatheringAvailability"/> → <see cref="MatchState.Confirmed"/> →
/// <see cref="MatchState.TeamsRolled"/> → <see cref="MatchState.InProgress"/> →
/// <see cref="MatchState.Completed"/>, with an admin-initiated <see cref="MatchState.Cancelled"/>
/// terminal state reachable before play.
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and soft-delete
/// state; a caller-supplied non-empty id is retained to support idempotent client-assigned writes
/// (Requirement 13.1, 1.7). The type uses only the .NET base class library and existing Domain
/// types, keeping Domain free of framework concerns (Requirement 16.1).
/// </para>
/// </summary>
public sealed class Match : BaseEntity
{
    /// <summary>The minimum trimmed length of a match location.</summary>
    public const int LocationMinLength = 1;

    /// <summary>The maximum trimmed length of a match location.</summary>
    public const int LocationMaxLength = 200;

    /// <summary>The minimum number of candidate days a draft may carry.</summary>
    public const int CandidateDayMinCount = 1;

    /// <summary>The maximum number of candidate days a draft may carry.</summary>
    public const int CandidateDayMaxCount = 14;

    /// <summary>The minimum number of players a team may carry at lock (Requirement 8.5).</summary>
    public const int TeamMinSize = 5;

    /// <summary>The maximum number of players a team may carry at lock (Requirement 8.5).</summary>
    public const int TeamMaxSize = 8;

    /// <summary>The minimum trimmed length of a team name at lock (Requirement 8.5).</summary>
    public const int TeamNameMinLength = 1;

    /// <summary>The maximum trimmed length of a team name at lock (Requirement 8.5).</summary>
    public const int TeamNameMaxLength = 50;

    private readonly List<CandidateDay> _candidateDays = [];
    private readonly List<AvailabilityResponse> _availabilityResponses = [];
    private readonly List<MatchParticipant> _participants = [];
    private readonly List<MatchTeam> _teams = [];

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private Match()
    {
        Location = string.Empty;
    }

    private Match(Guid id, Guid squadId, string location, IEnumerable<CandidateDay> candidateDays)
        : base(id)
    {
        SquadId = squadId;
        Location = location;
        State = MatchState.GatheringAvailability;
        _candidateDays.AddRange(candidateDays);
    }

    /// <summary>The identity of the squad that owns this match. Every match belongs to exactly one squad.</summary>
    public Guid SquadId { get; private set; }

    /// <summary>The current lifecycle state of the match.</summary>
    public MatchState State { get; private set; }

    /// <summary>
    /// The single candidate day an admin selected when confirming the match, becoming the match's
    /// scheduled date-and-time, or <see langword="null"/> while the match is still gathering
    /// availability (Requirement 6.1). Set only on a successful <see cref="Confirm"/>.
    /// </summary>
    public CandidateDay? ConfirmedDay { get; private set; }

    /// <summary>The trimmed, free-text place the match is played (1..200 characters).</summary>
    public string Location { get; private set; }

    /// <summary>The distinct candidate days on which members mark availability while gathering availability.</summary>
    public IReadOnlyCollection<CandidateDay> CandidateDays => _candidateDays;

    /// <summary>
    /// The availability responses currently stored for this match, at most one per squad membership
    /// (Requirement 4.2). A membership with no stored response is absent from this collection, which
    /// is distinct from a stored response marking an empty subset of candidate days (Requirement 4.7).
    /// </summary>
    public IReadOnlyCollection<AvailabilityResponse> AvailabilityResponses => _availabilityResponses;

    /// <summary>
    /// The match's playing pool. Registered participants are seeded on a successful
    /// <see cref="Confirm"/>, one per active registered member whose availability response marks the
    /// confirmed day (Requirement 6.5); guests are added by an admin once the match is
    /// <see cref="MatchState.Confirmed"/>. A membership appears at most once (Requirement 7.4).
    /// </summary>
    public IReadOnlyCollection<MatchParticipant> Participants => _participants;

    /// <summary>
    /// The match's current working teams, set by applying a team proposal and adjusted by an admin
    /// before locking (Requirement 8.1, 8.3). Empty until a proposal is applied. Together the teams
    /// partition the match's participants exactly — every participant on exactly one team, none
    /// unassigned, none duplicated (Requirement 8.2). Distinct from the immutable
    /// <see cref="KickoffLineup"/> captured at lock.
    /// </summary>
    public IReadOnlyCollection<MatchTeam> Teams => _teams;

    /// <summary>
    /// The immutable snapshot of teams and rosters captured when teams were last locked — the match's
    /// single rating unit — or <see langword="null"/> before the first successful <see cref="Lock"/>
    /// (Requirement 10.1). Re-locking while <see cref="MatchState.TeamsRolled"/> replaces it wholesale
    /// (Requirement 9.3).
    /// </summary>
    public KickoffLineup? KickoffLineup { get; private set; }

    /// <summary>
    /// Creates a match draft in <see cref="MatchState.GatheringAvailability"/> for
    /// <paramref name="squadId"/> (Requirement 1.1, 2.2). The draft is created only when every
    /// validation rule holds; on any failure a validation error is returned and no match is
    /// produced. Validation, in order:
    /// <list type="bullet">
    ///   <item>the trimmed <paramref name="location"/> length is 1..200 (Requirement 1.3);</item>
    ///   <item>the candidate-day count is 1..14 (Requirement 1.4);</item>
    ///   <item>the candidate days are distinct by instant (Requirement 1.5);</item>
    ///   <item>every candidate day is strictly after <paramref name="nowUtc"/> (Requirement 1.6).</item>
    /// </list>
    /// On success the match stores the trimmed location and exactly the supplied days as
    /// <see cref="CandidateDay"/> values. A non-empty <paramref name="id"/> is retained for
    /// idempotent creation; <see cref="Guid.Empty"/> auto-generates a GUID v7 (Requirement 13.1).
    /// Audit fields are populated by <see cref="BaseEntity"/> at persistence (Requirement 1.7).
    /// </summary>
    /// <param name="id">The caller-supplied GUID v7 identity, or <see cref="Guid.Empty"/> to auto-generate one.</param>
    /// <param name="squadId">The identity of the owning squad.</param>
    /// <param name="location">The requested match location; leading and trailing whitespace is trimmed.</param>
    /// <param name="candidateDays">The proposed candidate days; must be 1..14, distinct, and strictly future.</param>
    /// <param name="nowUtc">The current instant supplied by the clock, against which future-dating is checked.</param>
    /// <returns>A success carrying the new match, or a validation failure that creates no match.</returns>
    public static Result<Match> CreateDraft(
        Guid id,
        Guid squadId,
        string location,
        IReadOnlyList<DateTimeOffset> candidateDays,
        DateTimeOffset nowUtc)
    {
        var trimmed = location?.Trim() ?? string.Empty;
        if (trimmed.Length < LocationMinLength || trimmed.Length > LocationMaxLength)
        {
            return Result<Match>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Match location must be {LocationMinLength} to {LocationMaxLength} characters after trimming."));
        }

        if (candidateDays is null || candidateDays.Count < CandidateDayMinCount || candidateDays.Count > CandidateDayMaxCount)
        {
            return Result<Match>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"A match draft must have {CandidateDayMinCount} to {CandidateDayMaxCount} candidate days."));
        }

        var days = new List<CandidateDay>(candidateDays.Count);
        var seen = new HashSet<CandidateDay>();
        foreach (var day in candidateDays)
        {
            var candidate = new CandidateDay(day);

            if (!seen.Add(candidate))
            {
                return Result<Match>.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    "Candidate days must be distinct."));
            }

            if (candidate.Instant <= nowUtc)
            {
                return Result<Match>.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    "Candidate days must be in the future."));
            }

            days.Add(candidate);
        }

        return Result<Match>.Ok(new Match(id, squadId, trimmed, days));
    }

    /// <summary>
    /// Submits an availability response for <paramref name="squadMembershipId"/>, marking the subset of
    /// this match's candidate days given by <paramref name="markedDays"/> (Requirement 4.1). The
    /// operation is an upsert: any prior response for the same membership is replaced, so a membership
    /// retains at most one stored response (Requirement 4.2). Validation, in order:
    /// <list type="bullet">
    ///   <item>the match must be in <see cref="MatchState.GatheringAvailability"/>, else an
    ///   <see cref="MatchErrorCode.InvalidState"/> failure is returned and no response is stored or
    ///   changed (Requirement 4.6);</item>
    ///   <item>every marked day must be one of this match's candidate days; if any are not, a
    ///   <see cref="MatchErrorCode.ValidationFailed"/> failure is returned identifying each offending
    ///   day and the membership's stored response is left unchanged (Requirement 4.4).</item>
    /// </list>
    /// Duplicate marked days that resolve to the same candidate-day instant are collapsed, and a
    /// response marking none of the candidate days is stored as an empty-subset response that is
    /// distinct from the membership having no stored response (Requirement 4.7).
    /// </summary>
    /// <param name="squadMembershipId">The identity of the responding squad membership.</param>
    /// <param name="markedDays">The days the member marks as available; each must be a candidate day. May be empty.</param>
    /// <param name="submittedAt">The instant the response was submitted, recorded on the stored response.</param>
    /// <returns>A success carrying the stored response, or a validation/state failure that leaves stored responses unchanged.</returns>
    public Result<AvailabilityResponse> SubmitAvailability(
        Guid squadMembershipId,
        IReadOnlyList<DateTimeOffset> markedDays,
        DateTimeOffset submittedAt)
    {
        var guard = EnsureState(MatchState.GatheringAvailability);
        if (!guard.IsSuccess)
        {
            return Result<AvailabilityResponse>.Fail(guard.Error!);
        }

        var requested = markedDays ?? [];

        var marked = new List<CandidateDay>(requested.Count);
        var offending = new List<DateTimeOffset>();
        foreach (var day in requested)
        {
            var candidate = new CandidateDay(day);
            if (!_candidateDays.Contains(candidate))
            {
                offending.Add(day);
            }
            else if (!marked.Contains(candidate))
            {
                marked.Add(candidate);
            }
        }

        if (offending.Count > 0)
        {
            var offendingList = string.Join(", ", offending.Select(d => d.ToUniversalTime().ToString("O")));
            return Result<AvailabilityResponse>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Availability response references days that are not candidate days of this match: {offendingList}."));
        }

        _availabilityResponses.RemoveAll(r => r.SquadMembershipId == squadMembershipId);
        var response = new AvailabilityResponse(Id, squadMembershipId, marked, submittedAt);
        _availabilityResponses.Add(response);
        return Result<AvailabilityResponse>.Ok(response);
    }

    /// <summary>
    /// Clears <paramref name="squadMembershipId"/>'s stored availability response, so the membership
    /// reverts to having no stored response (Requirement 4.3). Permitted only while the match is in
    /// <see cref="MatchState.GatheringAvailability"/>; otherwise an <see cref="MatchErrorCode.InvalidState"/>
    /// failure is returned and stored responses are left unchanged (Requirement 4.6). Clearing when the
    /// membership has no stored response is a success that changes nothing.
    /// </summary>
    /// <param name="squadMembershipId">The identity of the membership whose response is cleared.</param>
    /// <returns>A success once cleared, or an <see cref="MatchErrorCode.InvalidState"/> failure.</returns>
    public Result ClearAvailability(Guid squadMembershipId)
    {
        var guard = EnsureState(MatchState.GatheringAvailability);
        if (!guard.IsSuccess)
        {
            return guard;
        }

        _availabilityResponses.RemoveAll(r => r.SquadMembershipId == squadMembershipId);
        return Result.Ok();
    }

    /// <summary>
    /// Returns the stored availability response for <paramref name="squadMembershipId"/>, or
    /// <see langword="null"/> when the membership has no stored response. A returned response marking
    /// an empty subset is distinct from this method returning <see langword="null"/> (Requirement 4.7).
    /// </summary>
    /// <param name="squadMembershipId">The identity of the membership whose response is requested.</param>
    /// <returns>The stored <see cref="AvailabilityResponse"/>, or <see langword="null"/> when none is stored.</returns>
    public AvailabilityResponse? GetAvailabilityResponse(Guid squadMembershipId) =>
        _availabilityResponses.FirstOrDefault(r => r.SquadMembershipId == squadMembershipId);

    /// <summary>
    /// Computes the <see cref="AvailabilityTally"/> for this match from its stored responses and
    /// candidate days (Requirement 5.1). Every candidate day is represented, so a day marked by no
    /// member reports a count of 0 and an empty member set (Requirement 5.2); a member with no stored
    /// response, and a member whose response does not mark a day, are excluded from that day's entry
    /// (Requirement 5.4). The aggregate holds at most one response per member (its upsert semantics),
    /// and the underlying computation resolves a member's single most recent response by submission
    /// time regardless (Requirement 5.3).
    /// <para>
    /// This computation counts exactly the responses stored on the match; scoping to active registered
    /// members is the caller's (Application layer's) concern, matching how authorisation is handled
    /// outside the aggregate.
    /// </para>
    /// </summary>
    /// <returns>The availability tally computed from this match's candidate days and stored responses.</returns>
    public AvailabilityTally ComputeAvailabilityTally() =>
        AvailabilityTally.Compute(_candidateDays, _availabilityResponses);

    /// <summary>
    /// Confirms the match on <paramref name="day"/>, transitioning
    /// <see cref="MatchState.GatheringAvailability"/> → <see cref="MatchState.Confirmed"/> and seeding
    /// the playing pool (Requirement 6.1). Validation, in order — each failure returns without
    /// mutating any state, leaving the match in <see cref="MatchState.GatheringAvailability"/> with no
    /// <see cref="ConfirmedDay"/> and no <see cref="Participants"/>:
    /// <list type="bullet">
    ///   <item>the match must be in <see cref="MatchState.GatheringAvailability"/>, else an
    ///   <see cref="MatchErrorCode.InvalidState"/> failure naming the required and current state is
    ///   returned (Requirement 2.3, 6.8);</item>
    ///   <item><paramref name="day"/> must resolve to one of this match's candidate days, else a
    ///   <see cref="MatchErrorCode.ValidationFailed"/> failure identifying the invalid day is returned
    ///   (Requirement 6.4);</item>
    ///   <item><paramref name="availableCount"/> must be greater than or equal to
    ///   <paramref name="minimumThreshold"/>, else a <see cref="MatchErrorCode.ThresholdNotMet"/>
    ///   failure stating the available count and the threshold is returned (Requirement 6.2).</item>
    /// </list>
    /// On success the confirmed day becomes the <see cref="ConfirmedDay"/>, the state becomes
    /// <see cref="MatchState.Confirmed"/>, and the participant set is seeded with exactly the supplied
    /// active registered members whose stored availability response marks the confirmed day, each as a
    /// registered <see cref="MatchParticipant"/> carrying its display-name-at-time (Requirement 6.5).
    /// Scoping <paramref name="activeRegisteredMembers"/> to active registered memberships of the
    /// squad is the caller's concern; the aggregate contributes the "response marks the confirmed day"
    /// filter from its own stored responses. Duplicate memberships in
    /// <paramref name="activeRegisteredMembers"/> yield at most one participant (Requirement 7.4).
    /// </summary>
    /// <param name="day">The candidate day to confirm on; must resolve, by instant, to one of the match's candidate days.</param>
    /// <param name="availableCount">The count of available active registered members on <paramref name="day"/>, evaluated by the caller.</param>
    /// <param name="minimumThreshold">The squad's minimum player threshold that the available count must meet.</param>
    /// <param name="activeRegisteredMembers">The active registered memberships of the squad (identity plus display name) from which participants are seeded.</param>
    /// <returns>A success once confirmed and seeded, or a validation/state/threshold failure that leaves the match unchanged.</returns>
    public Result Confirm(
        DateTimeOffset day,
        int availableCount,
        int minimumThreshold,
        IReadOnlyList<RegisteredMember> activeRegisteredMembers)
    {
        var guard = EnsureState(MatchState.GatheringAvailability);
        if (!guard.IsSuccess)
        {
            return guard;
        }

        var confirmedDay = new CandidateDay(day);
        if (!_candidateDays.Contains(confirmedDay))
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Cannot confirm on {day.ToUniversalTime():O} because it is not a candidate day of this match."));
        }

        if (availableCount < minimumThreshold)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ThresholdNotMet,
                $"Cannot confirm: {availableCount} available player(s) is below the minimum threshold of {minimumThreshold}."));
        }

        // Seed exactly the active registered members whose stored response marks the confirmed day.
        // Eligibility (active, registered) is the caller's concern; the aggregate owns the response check.
        var members = activeRegisteredMembers ?? [];
        var seeded = new List<MatchParticipant>(members.Count);
        var seenMemberships = new HashSet<Guid>();
        foreach (var member in members)
        {
            if (!seenMemberships.Add(member.SquadMembershipId))
            {
                continue;
            }

            var response = _availabilityResponses.FirstOrDefault(r => r.SquadMembershipId == member.SquadMembershipId);
            if (response is not null && response.Marks(confirmedDay))
            {
                seeded.Add(new MatchParticipant(Id, member.SquadMembershipId, member.DisplayName, isGuest: false, rosterPosition: seeded.Count));
            }
        }

        ConfirmedDay = confirmedDay;
        State = MatchState.Confirmed;
        _participants.Clear();
        _participants.AddRange(seeded);
        return Result.Ok();
    }

    /// <summary>
    /// Adds <paramref name="membership"/> to the match's playing pool as a
    /// <see cref="MatchParticipant"/>, capturing its <see cref="SquadMembership.DisplayName"/> as the
    /// display-name-at-time and assigning the next roster position (Requirement 7.1, 7.2). The
    /// participant is registered or guest according to the membership's backing. Validation, in order
    /// — each failure leaves the match's <see cref="Participants"/> unchanged:
    /// <list type="bullet">
    ///   <item>the match must be in <see cref="MatchState.Confirmed"/>, else an
    ///   <see cref="MatchErrorCode.InvalidState"/> failure naming the required and current state is
    ///   returned (Requirement 2.3, 2.5);</item>
    ///   <item>the membership must belong to this match's squad and have
    ///   <see cref="MembershipState.Active"/> state, else a <see cref="MatchErrorCode.ValidationFailed"/>
    ///   failure identifying the ineligible membership is returned (Requirement 7.3);</item>
    ///   <item>the membership must not already be a participant, else an
    ///   <see cref="MatchErrorCode.AlreadyParticipant"/> failure is returned and the membership is
    ///   retained as exactly one participant (Requirement 7.4).</item>
    /// </list>
    /// The Application layer decides which memberships an admin may add (a guest via
    /// <c>AddGuestParticipant</c>); the aggregate owns eligibility and the no-duplicate invariant.
    /// </summary>
    /// <param name="membership">The squad membership to add; must belong to this squad and be active.</param>
    /// <returns>A success carrying the new participant, or a state/validation/duplicate failure that leaves the participant set unchanged.</returns>
    public Result<MatchParticipant> AddParticipant(SquadMembership membership)
    {
        ArgumentNullException.ThrowIfNull(membership);

        var guard = EnsureState(MatchState.Confirmed);
        if (!guard.IsSuccess)
        {
            return Result<MatchParticipant>.Fail(guard.Error!);
        }

        if (membership.SquadId != SquadId || membership.State != MembershipState.Active)
        {
            return Result<MatchParticipant>.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Membership {membership.Id} is ineligible: it must belong to squad {SquadId} and be active."));
        }

        if (_participants.Any(p => p.SquadMembershipId == membership.Id))
        {
            return Result<MatchParticipant>.Fail(new MatchError(
                MatchErrorCode.AlreadyParticipant,
                $"Membership {membership.Id} is already a participant of this match."));
        }

        var participant = new MatchParticipant(
            Id,
            membership.Id,
            membership.DisplayName,
            membership.IsGuest,
            NextRosterPosition());
        _participants.Add(participant);
        return Result<MatchParticipant>.Ok(participant);
    }

    /// <summary>
    /// Removes the participant backed by <paramref name="squadMembershipId"/> from the match's
    /// playing pool, after which that membership is no longer a <see cref="MatchParticipant"/>
    /// (Requirement 7.2). Validation, in order — each failure leaves the match's
    /// <see cref="Participants"/> unchanged:
    /// <list type="bullet">
    ///   <item>the match must be in <see cref="MatchState.Confirmed"/>, else an
    ///   <see cref="MatchErrorCode.InvalidState"/> failure naming the required and current state is
    ///   returned (Requirement 2.3, 2.5);</item>
    ///   <item>the membership must currently be a participant, else a
    ///   <see cref="MatchErrorCode.NotAParticipant"/> failure is returned (Requirement 7.5).</item>
    /// </list>
    /// Remaining participants keep their existing roster positions.
    /// </summary>
    /// <param name="squadMembershipId">The identity of the participant membership to remove.</param>
    /// <returns>A success once removed, or a state/not-a-participant failure that leaves the participant set unchanged.</returns>
    public Result RemoveParticipant(Guid squadMembershipId)
    {
        var guard = EnsureState(MatchState.Confirmed);
        if (!guard.IsSuccess)
        {
            return guard;
        }

        var participant = _participants.FirstOrDefault(p => p.SquadMembershipId == squadMembershipId);
        if (participant is null)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.NotAParticipant,
                $"Membership {squadMembershipId} is not a participant of this match."));
        }

        _participants.Remove(participant);
        return Result.Ok();
    }

    /// <summary>
    /// Returns the next roster position to assign to a newly added participant: one past the highest
    /// existing roster position, or 0 when the pool is empty. Using the maximum (rather than the
    /// count) keeps positions stable and non-colliding across intervening removals.
    /// </summary>
    private int NextRosterPosition() =>
        _participants.Count == 0 ? 0 : _participants.Max(p => p.RosterPosition) + 1;

    /// <summary>
    /// Replaces the match's working teams with those described by <paramref name="teams"/>, the
    /// assignment proposed by the team balancer or built by an admin (Requirement 8.1, 8.3). The
    /// proposal must partition the match's participants exactly: every participant is assigned to
    /// exactly one team, no participant is unassigned, and no participant appears on more than one
    /// team (Requirement 8.2). Applying a proposal does not change the <see cref="State"/> — a
    /// proposal is returned to the admin for adjustment before locking (Requirement 8.1). Permitted
    /// only while the match is in <see cref="MatchState.Confirmed"/> or
    /// <see cref="MatchState.TeamsRolled"/> (a re-roll while already rolled is allowed,
    /// Requirement 9.3); otherwise an <see cref="MatchErrorCode.InvalidState"/> failure is returned
    /// and the working teams are left unchanged. Validation, in order — each failure leaves the
    /// working teams unchanged:
    /// <list type="bullet">
    ///   <item>at least one team must be supplied, else a <see cref="MatchErrorCode.ValidationFailed"/> failure is returned;</item>
    ///   <item>no squad-membership identity may appear on more than one team (Requirement 8.2);</item>
    ///   <item>every assigned identity must be a current participant of the match (Requirement 8.2);</item>
    ///   <item>every participant of the match must be assigned to some team (Requirement 8.2).</item>
    /// </list>
    /// Team-name length, team-size, and single-bib rules are not enforced here; they are validated at
    /// <see cref="Lock"/> (Requirement 8.5, 8.7), so an in-progress adjustment may be temporarily out
    /// of those bounds.
    /// </summary>
    /// <param name="teams">The proposed teams, each carrying a name, a bib flag, and an ordered roster of participant membership ids.</param>
    /// <returns>A success once the working teams are set, or a state/validation failure that leaves them unchanged.</returns>
    public Result ApplyTeamProposal(IReadOnlyList<ProposedTeam> teams)
    {
        var guard = EnsureTeamsEditable();
        if (!guard.IsSuccess)
        {
            return guard;
        }

        if (teams is null || teams.Count == 0)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                "A team proposal must contain at least one team."));
        }

        var participantIds = _participants.Select(p => p.SquadMembershipId).ToHashSet();
        var assigned = new HashSet<Guid>();
        foreach (var team in teams)
        {
            foreach (var membershipId in team.ParticipantMembershipIds ?? [])
            {
                if (!assigned.Add(membershipId))
                {
                    return Result.Fail(new MatchError(
                        MatchErrorCode.ValidationFailed,
                        $"Participant {membershipId} is assigned to more than one team; each participant must be on exactly one team."));
                }

                if (!participantIds.Contains(membershipId))
                {
                    return Result.Fail(new MatchError(
                        MatchErrorCode.ValidationFailed,
                        $"Assigned membership {membershipId} is not a participant of this match."));
                }
            }
        }

        if (assigned.Count != participantIds.Count)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                "Every participant must be assigned to exactly one team; the proposal leaves one or more participants unassigned."));
        }

        _teams.Clear();
        foreach (var team in teams)
        {
            _teams.Add(new MatchTeam(Id, team.TeamName ?? string.Empty, team.BibFlag, team.ParticipantMembershipIds ?? []));
        }

        return Result.Ok();
    }

    /// <summary>
    /// Moves the participant identified by <paramref name="squadMembershipId"/> from its current
    /// working team to the team identified by <paramref name="toTeamId"/>, preserving the exact
    /// partition of participants across teams (Requirement 8.2, 8.3). Permitted only while the match
    /// is in <see cref="MatchState.Confirmed"/> or <see cref="MatchState.TeamsRolled"/>; otherwise an
    /// <see cref="MatchErrorCode.InvalidState"/> failure is returned and the teams are left
    /// unchanged. Validation, in order — each failure leaves the teams unchanged:
    /// <list type="bullet">
    ///   <item>the membership must be a current participant of the match, else a
    ///   <see cref="MatchErrorCode.NotAParticipant"/> failure is returned;</item>
    ///   <item>the target team must be one of the match's working teams, else a
    ///   <see cref="MatchErrorCode.ValidationFailed"/> failure is returned;</item>
    ///   <item>the participant must currently be assigned to a working team, else a
    ///   <see cref="MatchErrorCode.ValidationFailed"/> failure is returned.</item>
    /// </list>
    /// Moving a participant to the team it is already on is a success that changes nothing.
    /// </summary>
    /// <param name="squadMembershipId">The identity of the participant to move.</param>
    /// <param name="toTeamId">The identity of the destination working team.</param>
    /// <returns>A success once moved, or a state/validation failure that leaves the teams unchanged.</returns>
    public Result MoveParticipant(Guid squadMembershipId, Guid toTeamId)
    {
        var guard = EnsureTeamsEditable();
        if (!guard.IsSuccess)
        {
            return guard;
        }

        if (_participants.All(p => p.SquadMembershipId != squadMembershipId))
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.NotAParticipant,
                $"Membership {squadMembershipId} is not a participant of this match."));
        }

        var target = _teams.FirstOrDefault(t => t.Id == toTeamId);
        if (target is null)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Team {toTeamId} is not a working team of this match."));
        }

        var current = _teams.FirstOrDefault(t => t.Contains(squadMembershipId));
        if (current is null)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Participant {squadMembershipId} is not assigned to any working team; apply a team proposal first."));
        }

        if (current.Id == target.Id)
        {
            return Result.Ok();
        }

        current.RemoveParticipant(squadMembershipId);
        target.AddParticipant(squadMembershipId);
        return Result.Ok();
    }

    /// <summary>
    /// Sets the <see cref="MatchTeam.TeamName"/> of the working team identified by
    /// <paramref name="teamId"/> to <paramref name="teamName"/> (Requirement 8.3). Permitted only
    /// while the match is in <see cref="MatchState.Confirmed"/> or <see cref="MatchState.TeamsRolled"/>;
    /// otherwise an <see cref="MatchErrorCode.InvalidState"/> failure is returned and the teams are
    /// left unchanged. If no working team matches <paramref name="teamId"/>, a
    /// <see cref="MatchErrorCode.ValidationFailed"/> failure is returned. The name is stored as
    /// supplied; its trimmed length and case-insensitive uniqueness are validated at
    /// <see cref="Lock"/> (Requirement 8.5, 8.7).
    /// </summary>
    /// <param name="teamId">The identity of the working team to rename.</param>
    /// <param name="teamName">The new team name; trimming and validation are applied at lock.</param>
    /// <returns>A success once the name is set, or a state/validation failure that leaves the teams unchanged.</returns>
    public Result SetTeamName(Guid teamId, string teamName)
    {
        var guard = EnsureTeamsEditable();
        if (!guard.IsSuccess)
        {
            return guard;
        }

        var team = _teams.FirstOrDefault(t => t.Id == teamId);
        if (team is null)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Team {teamId} is not a working team of this match."));
        }

        team.SetName(teamName ?? string.Empty);
        return Result.Ok();
    }

    /// <summary>
    /// Marks the working team identified by <paramref name="teamId"/> as the single bib-wearing team,
    /// setting its <see cref="MatchTeam.BibFlag"/> to <see langword="true"/> and clearing every other
    /// team's flag, so exactly one team carries the flag (Requirement 8.3, 8.5). Permitted only while
    /// the match is in <see cref="MatchState.Confirmed"/> or <see cref="MatchState.TeamsRolled"/>;
    /// otherwise an <see cref="MatchErrorCode.InvalidState"/> failure is returned and the teams are
    /// left unchanged. If no working team matches <paramref name="teamId"/>, a
    /// <see cref="MatchErrorCode.ValidationFailed"/> failure is returned.
    /// </summary>
    /// <param name="teamId">The identity of the working team to flag as bib-wearing.</param>
    /// <returns>A success once the bib team is set, or a state/validation failure that leaves the teams unchanged.</returns>
    public Result SetBibTeam(Guid teamId)
    {
        var guard = EnsureTeamsEditable();
        if (!guard.IsSuccess)
        {
            return guard;
        }

        if (_teams.All(t => t.Id != teamId))
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Team {teamId} is not a working team of this match."));
        }

        foreach (var team in _teams)
        {
            team.SetBib(team.Id == teamId);
        }

        return Result.Ok();
    }

    /// <summary>
    /// Locks the match's working teams, transitioning <see cref="MatchState.Confirmed"/> (or
    /// re-locking from <see cref="MatchState.TeamsRolled"/>) → <see cref="MatchState.TeamsRolled"/>
    /// and capturing a fresh immutable <see cref="KickoffLineup"/> from the locked teams
    /// (Requirement 8.5, 9.3, 10.1). Validation, in order — each failure returns a
    /// <see cref="MatchErrorCode.ValidationFailed"/> error naming the unmet rule and leaves the
    /// <see cref="State"/> and all match data, including any previously captured lineup, unchanged
    /// (Requirement 8.7):
    /// <list type="bullet">
    ///   <item>at least two teams must be present;</item>
    ///   <item>each team's roster size must be 5..8 players inclusive, with uneven sizes such as 7v6
    ///   permitted (Requirement 8.5, 8.6);</item>
    ///   <item>exactly one team must carry a <see langword="true"/> bib flag (Requirement 8.5);</item>
    ///   <item>every team name must have a trimmed length of 1..50 characters (Requirement 8.5);</item>
    ///   <item>no two team names may be equal after trimming and case-insensitive comparison
    ///   (Requirement 8.7).</item>
    /// </list>
    /// On success each team's stored name is normalised to its trimmed form and the captured
    /// <see cref="KickoffLineup"/> mirrors the locked teams and rosters; a re-lock replaces any prior
    /// lineup (Requirement 9.3).
    /// </summary>
    /// <returns>A success once locked and the lineup is captured, or a state/validation failure that leaves the match unchanged.</returns>
    public Result Lock()
    {
        var guard = EnsureTeamsEditable();
        if (!guard.IsSuccess)
        {
            return guard;
        }

        if (_teams.Count < 2)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                "A match must have at least two teams to be locked."));
        }

        foreach (var team in _teams)
        {
            if (team.Roster.Count < TeamMinSize || team.Roster.Count > TeamMaxSize)
            {
                return Result.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    $"Each team must have {TeamMinSize} to {TeamMaxSize} players, but a team has {team.Roster.Count}."));
            }
        }

        var bibCount = _teams.Count(t => t.BibFlag);
        if (bibCount != 1)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"Exactly one team must be flagged to wear bibs, but {bibCount} team(s) are flagged."));
        }

        var trimmedNames = new List<string>(_teams.Count);
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var team in _teams)
        {
            var trimmed = (team.TeamName ?? string.Empty).Trim();
            if (trimmed.Length < TeamNameMinLength || trimmed.Length > TeamNameMaxLength)
            {
                return Result.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    $"Each team name must be {TeamNameMinLength} to {TeamNameMaxLength} characters after trimming."));
            }

            if (!seenNames.Add(trimmed))
            {
                return Result.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    $"Team names must be distinct; '{trimmed}' is used by more than one team."));
            }

            trimmedNames.Add(trimmed);
        }

        // All rules hold: normalise names to their trimmed form and capture the lineup.
        for (var i = 0; i < _teams.Count; i++)
        {
            _teams[i].SetName(trimmedNames[i]);
        }

        State = MatchState.TeamsRolled;
        KickoffLineup = PitchMate.Domain.Matches.KickoffLineup.Capture(_teams);
        return Result.Ok();
    }

    /// <summary>
    /// Shared guard for the team-editing operations (apply proposal, move, name, bib, lock). Asserts
    /// the match is in <see cref="MatchState.Confirmed"/> or <see cref="MatchState.TeamsRolled"/> — the
    /// two states in which teams may be rolled, adjusted, and (re-)locked (Requirement 8.1, 9.3). When
    /// it is not, returns an <see cref="MatchErrorCode.InvalidState"/> failure naming the required and
    /// current state and mutates nothing (Requirement 2.5).
    /// </summary>
    /// <returns>A success when teams may be edited; otherwise an <see cref="MatchErrorCode.InvalidState"/> failure.</returns>
    private Result EnsureTeamsEditable()
    {
        if (State != MatchState.Confirmed && State != MatchState.TeamsRolled)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.InvalidState,
                $"Match must be in {MatchState.Confirmed} or {MatchState.TeamsRolled} to edit teams, but is {State}."));
        }

        return Result.Ok();
    }

    /// <summary>
    /// The source states from which a match may be cancelled by an admin before play
    /// (Requirement 2.6): <see cref="MatchState.GatheringAvailability"/>,
    /// <see cref="MatchState.Confirmed"/>, and <see cref="MatchState.TeamsRolled"/>. The in-play and
    /// terminal states (<see cref="MatchState.InProgress"/>, <see cref="MatchState.Completed"/>,
    /// <see cref="MatchState.Cancelled"/>) are deliberately excluded (Requirement 2.7, 15.3).
    /// </summary>
    private static readonly IReadOnlySet<MatchState> CancellableStates = new HashSet<MatchState>
    {
        MatchState.GatheringAvailability,
        MatchState.Confirmed,
        MatchState.TeamsRolled
    };

    /// <summary>
    /// Starts the match, transitioning <see cref="MatchState.TeamsRolled"/> →
    /// <see cref="MatchState.InProgress"/> (Requirement 2.3). The transition is rejected with an
    /// <see cref="MatchErrorCode.InvalidState"/> error naming the required and current state when the
    /// match is in any other state, including the terminal <see cref="MatchState.Completed"/> and
    /// <see cref="MatchState.Cancelled"/> states (Requirement 11.1, 15.1, 15.3); on rejection
    /// <see cref="State"/> and all match data are left unchanged (Requirement 15.2).
    /// </summary>
    /// <returns>A success once started, or an <see cref="MatchErrorCode.InvalidState"/> failure.</returns>
    public Result Start()
    {
        var guard = EnsureState(MatchState.TeamsRolled);
        if (!guard.IsSuccess)
        {
            return guard;
        }

        State = MatchState.InProgress;
        return Result.Ok();
    }

    /// <summary>
    /// Cancels the match, transitioning it to <see cref="MatchState.Cancelled"/> (Requirement 2.6).
    /// Cancellation is permitted only from <see cref="MatchState.GatheringAvailability"/>,
    /// <see cref="MatchState.Confirmed"/>, or <see cref="MatchState.TeamsRolled"/>; a request from any
    /// other state — including the in-play <see cref="MatchState.InProgress"/> state and the terminal
    /// <see cref="MatchState.Completed"/>/<see cref="MatchState.Cancelled"/> states — is rejected with
    /// an <see cref="MatchErrorCode.InvalidState"/> error naming the current state (Requirement 2.7,
    /// 11.1, 15.1, 15.3), leaving <see cref="State"/> and all match data unchanged (Requirement 15.2).
    /// </summary>
    /// <returns>A success once cancelled, or an <see cref="MatchErrorCode.InvalidState"/> failure.</returns>
    public Result Cancel()
    {
        if (!CancellableStates.Contains(State))
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.InvalidState,
                $"Match must be in {MatchState.GatheringAvailability}, {MatchState.Confirmed}, or {MatchState.TeamsRolled} to be cancelled, but is {State}."));
        }

        State = MatchState.Cancelled;
        return Result.Ok();
    }

    /// <summary>
    /// Shared lifecycle guard reused by the forward state transitions (Requirement 15.1). Asserts the
    /// match is in <paramref name="required"/>; when it is not, returns an
    /// <see cref="MatchErrorCode.InvalidState"/> failure naming both the required and current state and
    /// leaves <see cref="State"/> and all match data unchanged (Requirement 15.2, 15.3). The check is
    /// pure — it mutates nothing on either the success or failure path.
    /// </summary>
    /// <param name="required">The single state the operation demands as its source.</param>
    /// <returns>A success when <see cref="State"/> equals <paramref name="required"/>; otherwise an <see cref="MatchErrorCode.InvalidState"/> failure.</returns>
    private Result EnsureState(MatchState required)
    {
        if (State != required)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.InvalidState,
                $"Match must be in {required} for this operation, but is {State}."));
        }

        return Result.Ok();
    }
}
