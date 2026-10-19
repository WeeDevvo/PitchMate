using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Tests.Persistence;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using RatingEngineConfig = PitchMate.Domain.Rating.RatingEngineConfig;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Model-based property tests for the team sheet and the single display-name rule (match-read-models
/// tasks 13.8–13.9), driving the real <see cref="GetTeamSheetHandler"/>, detail and working-teams reads
/// over the production EF gateways on Testcontainers PostgreSQL. Requires Docker.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class TeamSheetPropertyTests
{
    private const int MaxTest = 10;

    private static readonly IRatingEngine Engine = new PlackettLuceRatingEngine(new RatingEngineConfig());

    private static MatchListSourceHarness? _shared;

    private readonly MatchListSourceHarness _harness;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    public TeamSheetPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _harness = _shared ??= new MatchListSourceHarness(fixture, "team_sheet_properties");
    }

    // Feature: match-read-models, Property 22: The team sheet is readable whenever a lineup was locked,
    // and projects that lineup.
    /// <summary>
    /// **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6, 10.8** — for every match of every state, the
    /// sheet is answered exactly when a lineup was captured and then projects it structurally; otherwise
    /// the read answers <c>InvalidState</c> with no sheet and changes nothing; and a re-lock re-projects.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property TeamSheetIsReadableWheneverALineupWasLockedAndProjectsIt() =>
        Prop.ForAll(Arb.From(MatchListDatasetGenerators.Dataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset seeded = await _harness.SeedAsync(spec);

            // Non-vacuity: the post-lock states the new gate opens are present.
            List<Match> admitted = [.. seeded.Squads.SelectMany(static squad => squad.Admitted)];
            Assert.Contains(admitted, static match => match.State == MatchState.InProgress && match.KickoffLineup is not null);
            Assert.Contains(admitted, static match => match.State == MatchState.Completed && match.KickoffLineup is not null);

            foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
            {
                Guid caller = squad.Organiser.UserId!.Value;

                foreach (Match match in squad.Admitted)
                {
                    MatchDetailProjection? before = await _harness.FindDetailAsync(match.Id);
                    Result<TeamSheet> sheet = await _harness.GetTeamSheetAsync(caller, match.Id);

                    if (match.KickoffLineup is null)
                    {
                        Assert.False(sheet.IsSuccess);
                        Assert.Null(sheet.Value);
                        Assert.Equal(MatchErrorCode.InvalidState, sheet.Error!.Code);
                        MatchDetailReferenceOracle.AssertAgrees(before!, await _harness.FindDetailAsync(match.Id));
                    }
                    else
                    {
                        Assert.True(sheet.IsSuccess, $"{match.State}: {sheet.Error?.Message}");
                        TeamSheetReferenceOracle.AssertProjects(squad, match, sheet.Value!);
                    }
                }

                // A re-lock re-projects: a rolled match whose first team can give up a player and the
                // second can take one is moved and re-locked, and the sheet must project the lineup as
                // re-captured. The expectation is the aggregate as the repository persisted it, since
                // a rehydrated match holds its teams in identity order.
                Match? relockable = squad.Admitted.FirstOrDefault(static match =>
                    match.State == MatchState.TeamsRolled
                    && match.KickoffLineup!.Teams[0].ParticipantMembershipIds.Count > Match.TeamMinSize
                    && match.KickoffLineup.Teams[1].ParticipantMembershipIds.Count < Match.TeamMaxSize);
                if (relockable is not null)
                {
                    Guid moving = await _harness.MoveAndRelockAsync(relockable.Id);
                    Match persisted = await _harness.LoadMatchAsync(relockable.Id);
                    Assert.DoesNotContain(
                        persisted.KickoffLineup!.Teams,
                        team => team.ParticipantMembershipIds.SequenceEqual(relockable.KickoffLineup!.Teams.Single(t => t.TeamName == team.TeamName).ParticipantMembershipIds));

                    Result<TeamSheet> relocked = await _harness.GetTeamSheetAsync(caller, relockable.Id);
                    TeamSheetReferenceOracle.AssertProjects(squad, persisted, relocked.Value!);
                    Assert.Contains(relocked.Value!.Teams, team => team.Roster.Any(entry => entry.SquadMembershipId == moving));
                }
            }

            return true;
        }));

    // Feature: match-read-models, Property 23: One display-name rule, applied everywhere, defeating no
    // erasure.
    /// <summary>
    /// **Validates: Requirements 2.13, 4.6, 4.7, 10.7** — with anonymised members, a blank captured name
    /// and a locked identity whose participant is gone, the detail's participant view, the working-teams
    /// roster entry and the team-sheet roster entry report the same name for the same membership; the
    /// placeholder whenever the membership is anonymised or unresolved; never an empty name; and never the
    /// captured name of an anonymised membership.
    /// </summary>
    [Property(MaxTest = MaxTest)]
    public Property OneDisplayNameRuleAppliedEverywhere() =>
        Prop.ForAll(Arb.From(NameRuleDataset()), spec => RunAsync(async () =>
        {
            SeededMatchListDataset.SquadData squad = (await _harness.SeedAsync(spec)).SquadAt(0);
            Match match = squad.Matches[0];
            Guid caller = squad.Organiser.UserId!.Value;

            // Plants: a blank captured name on a live member, and a locked identity whose participant
            // row is gone (both distinct from the organiser and the anonymised tail).
            Guid blanked = match.KickoffLineup!.Teams[0].ParticipantMembershipIds.First(id => id != squad.Organiser.Id && !IsAnonymised(squad, id));
            Guid orphaned = match.KickoffLineup.Teams[1].ParticipantMembershipIds.First(id => id != squad.Organiser.Id && id != blanked && !IsAnonymised(squad, id));
            await _harness.PlantCapturedDisplayNameAsync(match.Id, blanked, "  ");
            await _harness.PlantDeletedParticipantAsync(match.Id, orphaned);

            MatchDetail detail = (await _harness.GetDetailAsync(caller, match.Id)).Value!;
            WorkingTeamsView teams = (await _harness.GetWorkingTeamsAsync(caller, match.Id, Engine)).Value!;
            TeamSheet sheet = (await _harness.GetTeamSheetAsync(caller, match.Id)).Value!;

            var reported = new Dictionary<Guid, List<string>>();
            void Report(Guid id, string name)
            {
                if (!reported.TryGetValue(id, out List<string>? names))
                {
                    reported[id] = names = [];
                }

                names.Add(name);
            }

            foreach (ParticipantView view in detail.Participants)
            {
                Report(view.SquadMembershipId, view.DisplayName);
            }

            foreach (RosterEntry entry in teams.Teams.SelectMany(static team => team.Roster))
            {
                Report(entry.SquadMembershipId, entry.DisplayName);
            }

            foreach (RosterEntry entry in sheet.Teams.SelectMany(static team => team.Roster))
            {
                Report(entry.SquadMembershipId, entry.DisplayName);
            }

            Assert.InRange(reported.Count, 8, 20);
            Assert.Contains(reported.Keys, id => IsAnonymised(squad, id));

            foreach ((Guid id, List<string> names) in reported)
            {
                Assert.All(names, static name => Assert.False(string.IsNullOrWhiteSpace(name)));
                Assert.Single(names.Distinct());

                SquadMembership membership = squad.MembershipById(id);
                bool placeholderExpected = IsAnonymised(squad, id) || id == blanked || id == orphaned;
                Assert.Equal(placeholderExpected, names[0] == SquadMembership.DisplayNamePlaceholder);

                if (IsAnonymised(squad, id))
                {
                    string captured = match.Participants.Single(participant => participant.SquadMembershipId == id).DisplayName;
                    Assert.NotEqual(captured, names[0]);
                }
                else if (!placeholderExpected)
                {
                    Assert.Equal(membership.DisplayName, names[0]);
                }
            }

            return true;
        }));

    /// <summary>
    /// One squad of 10–16 registered members who all play one rolled match, the last 2–3 of them
    /// anonymised afterwards, so anonymised identities sit on every name surface.
    /// </summary>
    private static Gen<MatchListDatasetSpec> NameRuleDataset() =>
        from registered in Gen.Choose(10, 16)
        from anonymised in Gen.Choose(2, 3)
        from day in Gen.Choose(1, 60)
        select new MatchListDatasetSpec(
        [
            new MatchListDatasetSpec.SquadSpec(
                registered,
                [new MatchListDatasetSpec.MatchSpec(MatchState.TeamsRolled, [day], ParticipantCount: registered)],
                AnonymisedCount: anonymised),
        ]);

    private static bool IsAnonymised(SeededMatchListDataset.SquadData squad, Guid membershipId) =>
        squad.MembershipById(membershipId).DisplayNameNormalized is null;

    private static bool RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult();
}
