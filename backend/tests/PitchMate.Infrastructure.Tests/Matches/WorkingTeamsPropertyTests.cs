using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Tests.Persistence;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using MatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using MatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using RatingEngineConfig = PitchMate.Domain.Rating.RatingEngineConfig;
using RatingState = PitchMate.Domain.Rating.RatingState;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Model-based property tests for the working-teams read (match-read-models tasks 11.10–11.14), driving
/// the real <c>EfWorkingTeamsSource</c> and <see cref="GetWorkingTeamsHandler"/> — and, for Property 11,
/// the real <see cref="AdjustTeamsHandler"/> behind the team-editing writes — on Testcontainers
/// PostgreSQL, against <see cref="WorkingTeamsReferenceOracle"/>. Requires Docker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class WorkingTeamsPropertyTests
{
    private const int MaxTest = 10;

    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public WorkingTeamsPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "working_teams_properties");
    }

    // Feature: match-read-models, Property 10: The working-teams projection equals its specification,
    // verbatim.
    /// <summary>
    /// **Validates: Requirements 4.3, 4.4, 4.5, 4.8, 4.12, 4.14, 13.3** — every match's working teams are
    /// structurally equal to the oracle's: creation order, stored roster order with a moved participant
    /// last, names and bib flags exactly as stored, and exactly the teams the aggregate holds.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property WorkingTeamsProjectionEqualsItsSpecificationVerbatim() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.TeamsDataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);
            var engine = new CountingRatingEngine();

            // Non-vacuity: the verbatim clauses each have a case to bite on.
            List<Match> matches = [.. seeded.Squads.SelectMany(static squad => squad.Admitted)];
            Assert.Contains(matches, static match => match.Teams.Any(static team => string.IsNullOrWhiteSpace(team.TeamName)));
            Assert.Contains(matches, static match => match.Teams.Count >= 2 && match.Teams.All(static team => !team.BibFlag));
            Assert.Contains(matches, static match => match.Teams.Count(static team => team.BibFlag) == 2);
            Assert.Contains(matches, static match => match.KickoffLineup is { } lineup
                && lineup.Teams.Any(locked => !match.Teams.Any(team => team.Roster.ToHashSet().SetEquals(locked.ParticipantMembershipIds))));

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                foreach (Match match in squad.Admitted)
                {
                    WorkingTeamsReferenceOracle.AssertAgrees(
                        WorkingTeamsReferenceOracle.Expected(squad, match, engine.Inner),
                        await ReadAsync(squad, match, engine));
                }
            }

            return true;
        }));

    // Feature: match-read-models, Property 11: Every returned working-team id is accepted by both
    // team-editing writes.
    /// <summary>
    /// **Validates: Requirement 4.2** — for every match in a state that permits team editing, every team
    /// id the read returned is accepted as the <c>teamId</c> of the rename write and of the bib write,
    /// with no identity taken from any other source.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property EveryReturnedTeamIdIsAcceptedByBothWrites() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.TeamsDataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);
            var engine = new CountingRatingEngine();
            int driven = 0;

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                Guid organiser = squad.Organiser.UserId!.Value;

                foreach (Match match in squad.Admitted.Where(static match => match.State is MatchState.Confirmed or MatchState.TeamsRolled))
                {
                    WorkingTeamsView view = await ReadAsync(squad, match, engine);

                    foreach ((WorkingTeamView team, int index) in view.Teams.Select(static (team, index) => (team, index)))
                    {
                        PitchMate.Domain.Matches.Result renamed = await _harness.AdjustTeamsAsync(
                            organiser, match.Id, new TeamAdjustment.SetTeamName(team.TeamId, $"Renamed {index}"), engine);
                        PitchMate.Domain.Matches.Result bib = await _harness.AdjustTeamsAsync(
                            organiser, match.Id, new TeamAdjustment.SetBibTeam(team.TeamId), engine);

                        Assert.True(renamed.IsSuccess, renamed.Error?.Message);
                        Assert.True(bib.IsSuccess, bib.Error?.Message);
                        driven++;
                    }
                }
            }

            Assert.True(driven > 0, "No team id was driven through the writes.");
            return true;
        }));

    // Feature: match-read-models, Property 12: The working teams partition the rostered identities, and
    // name the rest.
    /// <summary>
    /// **Validates: Requirements 4.13, 13.7** — no identity is on two rosters, and each participant is on
    /// exactly one roster or among the unassigned, never both — including participants added after the
    /// proposal was applied.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property WorkingTeamsPartitionTheRosteredAndNameTheRest() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.TeamsDataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);
            var engine = new CountingRatingEngine();
            bool sawLateAddition = false;

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                foreach (Match match in squad.Admitted)
                {
                    WorkingTeamsView view = await ReadAsync(squad, match, engine);
                    List<Guid> rostered = [.. view.Teams.SelectMany(static team => team.Roster).Select(static entry => entry.SquadMembershipId)];

                    Assert.Equal(rostered.Count, rostered.Distinct().Count());

                    foreach (Guid participant in match.Participants.Select(static p => p.SquadMembershipId))
                    {
                        bool onRoster = rostered.Contains(participant);
                        bool unassigned = view.UnassignedParticipants.Contains(participant);
                        Assert.True(onRoster ^ unassigned, $"Participant {participant}: rostered={onRoster}, unassigned={unassigned}.");
                    }

                    sawLateAddition |= view.Teams.Count > 0 && view.UnassignedParticipants.Count > 0;
                }
            }

            Assert.True(sawLateAddition, "No match carried a participant added after the proposal.");
            return true;
        }));

    // Feature: match-read-models, Property 13: The split prediction is the engine's, exactly once, and
    // only where the engine accepts the arrangement.
    /// <summary>
    /// **Validates: Requirements 4.9, 4.10, 4.11, 4.16, 4.18, 6.3, 6.9** — with two or more non-empty
    /// rosters the read predicts once, in team order, each value in [0, 1], the wins and the draw summing
    /// to 1 as shares of the whole outcome, and every value within 1e-9 of the oracle's call to the same engine;
    /// otherwise it predicts nothing and calls the engine zero times. A move is reflected on the next
    /// read, and repeated reads with no write between them agree.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property SplitPredictionIsTheEnginesExactlyOnceAndOnlyWhereAccepted() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.TeamsDataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);
            var engine = new CountingRatingEngine();

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                foreach (Match match in squad.Admitted)
                {
                    bool accepted = match.Teams.Count >= 2 && match.Teams.All(static team => team.Roster.Count > 0);

                    int before = engine.PredictCalls;
                    WorkingTeamsView first = await ReadAsync(squad, match, engine);
                    Assert.Equal(accepted ? 1 : 0, engine.PredictCalls - before);

                    if (first.Prediction is { } prediction)
                    {
                        Assert.Equal(first.Teams.Count, prediction.WinProbabilities.Count);
                        Assert.All(prediction.WinProbabilities, static p => Assert.InRange(p, 0, 1));
                        Assert.InRange(prediction.DrawProbability, 0, 1);
                        Assert.Equal(1.0, prediction.WinProbabilities.Sum() + prediction.DrawProbability, 1e-6);
                    }

                    WorkingTeamsReferenceOracle.AssertAgrees(WorkingTeamsReferenceOracle.Expected(squad, match, engine.Inner), first);

                    WorkingTeamsView again = await ReadAsync(squad, match, engine);
                    WorkingTeamsReferenceOracle.AssertAgrees(first, again);
                }

                // A move is reflected on the next read: move one participant of the first editable,
                // accepted arrangement across, in the database and in the oracle's aggregate alike.
                Match? editable = squad.Admitted.FirstOrDefault(static match =>
                    match.State == MatchState.Confirmed && match.Teams.Count >= 2 && match.Teams.All(static team => team.Roster.Count > 1));
                if (editable is not null)
                {
                    List<MatchTeam> teams = [.. editable.Teams.OrderBy(static team => team.Id, UuidV7Comparer.Instance)];
                    Guid moving = teams[0].Roster[0];

                    PitchMate.Domain.Matches.Result moved = await _harness.AdjustTeamsAsync(
                        squad.Organiser.UserId!.Value, editable.Id, new TeamAdjustment.MoveParticipant(moving, teams[1].Id), engine);
                    Assert.True(moved.IsSuccess, moved.Error?.Message);
                    Assert.True(editable.MoveParticipant(moving, teams[1].Id).IsSuccess);

                    WorkingTeamsReferenceOracle.AssertAgrees(
                        WorkingTeamsReferenceOracle.Expected(squad, editable, engine.Inner),
                        await ReadAsync(squad, editable, engine));
                }
            }

            return true;
        }));

    // Feature: match-read-models, Property 7: Every match read answers from every lifecycle state.
    /// <summary>
    /// **Validates: Requirements 2.8, 3.9, 4.15** — for a match in any of the six states, the detail read
    /// and the working-teams read both succeed with their declared contract and no invalid-state failure,
    /// and the caller's availability is reported in every state.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property EveryMatchReadAnswersFromEveryState() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);
            var engine = new CountingRatingEngine();

            Assert.Equal(
                Enum.GetValues<MatchState>().OrderBy(static state => state),
                seeded.SquadAt(0).Admitted.Select(static match => match.State).Distinct().OrderBy(static state => state));

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                Guid organiser = squad.Organiser.UserId!.Value;

                foreach (Match match in squad.Admitted)
                {
                    Result<MatchDetail> detail = await _harness.GetDetailAsync(organiser, match.Id);
                    Assert.True(detail.IsSuccess, $"{match.State}: {detail.Error?.Message}");
                    Assert.NotNull(detail.Value!.CallerAvailability);
                    Assert.Equal(
                        MatchDetailReferenceOracle.CallerAvailabilityOf(squad, match.Id, squad.Organiser.Id).HasStoredResponse,
                        detail.Value.CallerAvailability.HasStoredResponse);

                    Result<WorkingTeamsView> teams = await _harness.GetWorkingTeamsAsync(organiser, match.Id, engine);
                    Assert.True(teams.IsSuccess, $"{match.State}: {teams.Error?.Message}");
                }
            }

            return true;
        }));

    private async Task<WorkingTeamsView> ReadAsync(SeededMatchListDataset.SquadData squad, Match match, IRatingEngine engine)
    {
        Result<WorkingTeamsView> result = await _harness.GetWorkingTeamsAsync(squad.Organiser.UserId!.Value, match.Id, engine);
        Assert.True(result.IsSuccess, result.Error?.Message);
        return result.Value!;
    }

    private static bool RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult();

    /// <summary>
    /// The production engine, wrapped to count <see cref="Predict"/> calls. The oracle calls
    /// <see cref="Inner"/> — the same instance — so its calls are not counted.
    /// </summary>
    private sealed class CountingRatingEngine : IRatingEngine
    {
        public IRatingEngine Inner { get; } = new PlackettLuceRatingEngine(new RatingEngineConfig());

        public int PredictCalls { get; private set; }

        public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters)
        {
            PredictCalls++;
            return Inner.Predict(rosters);
        }

        public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) => Inner.CreateRating(tier);

        public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) => Inner.GetState(rating);

        public PitchMate.Domain.Rating.Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) => Inner.UpdateRatings(outcome);

        public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(IReadOnlyList<PlayerRating> initialRatings, IReadOnlyList<ReplayMatch> matches) =>
            Inner.Replay(initialRatings, matches);

        public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
            Inner.DecayInactivity(rating, inactiveDays);
    }
}
