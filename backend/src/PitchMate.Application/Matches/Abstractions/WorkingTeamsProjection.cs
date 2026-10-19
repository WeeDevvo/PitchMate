using PitchMate.Application.Matches.UseCases;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// What <see cref="IWorkingTeamsSource"/> reads for one match: the teams and their rosters, the
/// participants, and the inputs the handler needs to ask the rating engine for a prediction.
/// <para>
/// <see cref="RatingsByMembershipId"/> is the <b>only place a μ/σ pair exists in this chore</b>. It
/// lives for one handler call so the handler can call <c>IRatingEngine.Predict</c>, and reaches no
/// response contract (Requirements 6.1, 11.2).
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the match.</param>
/// <param name="SquadId">The owning squad, for resolving the acting membership.</param>
/// <param name="Teams">The working teams in creation order, rosters in stored order with names resolved.</param>
/// <param name="ParticipantIds">The participants' squad-membership identities in roster-position order.</param>
/// <param name="RatingsByMembershipId">The <b>persisted</b> rating of each rated member of the squad.</param>
/// <param name="SkillTiersByMembershipId">Each squad member's skill tier, for seeding an unrated member in memory.</param>
public sealed record WorkingTeamsProjection(
    Guid MatchId,
    Guid SquadId,
    IReadOnlyList<WorkingTeamView> Teams,
    IReadOnlyList<Guid> ParticipantIds,
    IReadOnlyDictionary<Guid, PlayerRating> RatingsByMembershipId,
    IReadOnlyDictionary<Guid, SkillTier?> SkillTiersByMembershipId);
