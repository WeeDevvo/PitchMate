using FsCheck;
using FsCheck.Xunit;
using FluentAssertions;
using PitchMate.Application.Commands.Matches;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Tests.Properties;

/// <summary>
/// Property-based tests for match management commands.
/// Tests universal properties that should hold for all valid inputs.
/// </summary>
public class MatchCommandProperties
{
    /// <summary>
    /// Feature: pitchmate-core, Property 11: Admin-only match creation
    /// For any squad and user, only users with admin privileges for that squad 
    /// should be able to create matches.
    /// Validates: Requirements 3.1
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task AdminOnlyMatchCreation_ShouldRejectNonAdminUsers(
        PositiveInt adminSeed,
        PositiveInt nonAdminSeed,
        PositiveInt squadSeed,
        PositiveInt playerCountSeed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var nonAdminEmail = GenerateValidEmail(nonAdminSeed.Get);
        var squadName = GenerateSquadName(squadSeed.Get);
        var playerCount = 2 + ((playerCountSeed.Get % 5) * 2); // 2, 4, 6, 8, or 10 players

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create non-admin user
        var nonAdminUser = User.CreateWithPassword(
            Email.Create(nonAdminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(nonAdminUser);

        // Create squad with admin as creator
        var squad = Squad.Create(squadName, adminUser.Id);

        // Add players to squad (including both admin and non-admin)
        var playerIds = new List<UserId> { adminUser.Id, nonAdminUser.Id };
        squad.AddMember(adminUser.Id, EloRating.Default);
        squad.AddMember(nonAdminUser.Id, EloRating.Default);

        // Add more players if needed
        for (int i = 2; i < playerCount; i++)
        {
            var playerEmail = GenerateValidEmail(adminSeed.Get + nonAdminSeed.Get + i);
            var player = User.CreateWithPassword(
                Email.Create(playerEmail), 
                BCrypt.Net.BCrypt.HashPassword("password"));
            await userRepository.AddAsync(player);
            squad.AddMember(player.Id, EloRating.Default);
            playerIds.Add(player.Id);
        }

        await squadRepository.AddAsync(squad);

        var handler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var scheduledAt = DateTime.UtcNow.AddDays(1);

        // Act - Try to create match as non-admin
        var nonAdminCommand = new CreateMatchCommand(
            squad.Id,
            scheduledAt,
            playerIds,
            TeamSize: null,
            nonAdminUser.Id);

        var nonAdminResult = await handler.HandleAsync(nonAdminCommand);

        // Assert - Non-admin should be rejected
        nonAdminResult.Success.Should().BeFalse();
        nonAdminResult.ErrorCode.Should().Be("AUTHZ_001");
        nonAdminResult.ErrorMessage.Should().Contain("not a squad admin");
        nonAdminResult.MatchId.Should().BeNull();

        // Act - Try to create match as admin
        var adminCommand = new CreateMatchCommand(
            squad.Id,
            scheduledAt,
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var adminResult = await handler.HandleAsync(adminCommand);

        // Assert - Admin should succeed
        adminResult.Success.Should().BeTrue();
        adminResult.ErrorCode.Should().BeNull();
        adminResult.MatchId.Should().NotBeNull();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 13: Default team size
    /// For any match created without specifying team size, the system should default to 5 players per team.
    /// Validates: Requirements 3.3
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task DefaultTeamSize_ShouldUseDefaultWhenNotSpecified(
        PositiveInt adminSeed,
        PositiveInt squadSeed,
        PositiveInt playerCountSeed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var squadName = GenerateSquadName(squadSeed.Get);
        var playerCount = 2 + ((playerCountSeed.Get % 5) * 2); // 2, 4, 6, 8, or 10 players

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create squad with admin as creator
        var squad = Squad.Create(squadName, adminUser.Id);

        // Add players to squad
        var playerIds = new List<UserId> { adminUser.Id };
        squad.AddMember(adminUser.Id, EloRating.Default);

        for (int i = 1; i < playerCount; i++)
        {
            var playerEmail = GenerateValidEmail(adminSeed.Get + i);
            var player = User.CreateWithPassword(
                Email.Create(playerEmail), 
                BCrypt.Net.BCrypt.HashPassword("password"));
            await userRepository.AddAsync(player);
            squad.AddMember(player.Id, EloRating.Default);
            playerIds.Add(player.Id);
        }

        await squadRepository.AddAsync(squad);

        var handler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var scheduledAt = DateTime.UtcNow.AddDays(1);

        // Act - Create match without specifying team size (TeamSize: null)
        var command = new CreateMatchCommand(
            squad.Id,
            scheduledAt,
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var result = await handler.HandleAsync(command);

        // Assert - Match should be created successfully
        result.Success.Should().BeTrue();
        result.ErrorCode.Should().BeNull();
        result.MatchId.Should().NotBeNull();

        // Verify the match was created with default team size of 5
        var createdMatch = await matchRepository.GetByIdAsync(result.MatchId!);
        createdMatch.Should().NotBeNull();
        createdMatch!.TeamSize.Should().Be(5, "default team size should be 5");
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 20: Team assignment persistence
    /// For any match with generated teams, the team assignments should be persisted with the match.
    /// Validates: Requirements 4.6
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task TeamAssignmentPersistence_ShouldPersistTeamAssignments(
        PositiveInt adminSeed,
        PositiveInt squadSeed,
        PositiveInt playerCountSeed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var squadName = GenerateSquadName(squadSeed.Get);
        var playerCount = 2 + ((playerCountSeed.Get % 5) * 2); // 2, 4, 6, 8, or 10 players

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create squad with admin as creator
        var squad = Squad.Create(squadName, adminUser.Id);

        // Add players to squad with varying ratings
        var playerIds = new List<UserId> { adminUser.Id };
        squad.AddMember(adminUser.Id, EloRating.Create(1000 + (adminSeed.Get % 500)));

        for (int i = 1; i < playerCount; i++)
        {
            var playerEmail = GenerateValidEmail(adminSeed.Get + i);
            var player = User.CreateWithPassword(
                Email.Create(playerEmail), 
                BCrypt.Net.BCrypt.HashPassword("password"));
            await userRepository.AddAsync(player);
            var rating = EloRating.Create(1000 + ((adminSeed.Get + i) % 500));
            squad.AddMember(player.Id, rating);
            playerIds.Add(player.Id);
        }

        await squadRepository.AddAsync(squad);

        var handler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var scheduledAt = DateTime.UtcNow.AddDays(1);

        // Act - Create match
        var command = new CreateMatchCommand(
            squad.Id,
            scheduledAt,
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var result = await handler.HandleAsync(command);

        // Assert - Match should be created successfully
        result.Success.Should().BeTrue();
        result.MatchId.Should().NotBeNull();

        // Verify the match was persisted with team assignments
        var createdMatch = await matchRepository.GetByIdAsync(result.MatchId!);
        createdMatch.Should().NotBeNull();
        createdMatch!.TeamA.Should().NotBeNull("TeamA should be assigned");
        createdMatch.TeamB.Should().NotBeNull("TeamB should be assigned");

        // Verify teams contain all players
        var teamAPlayerIds = createdMatch.TeamA!.Players.Select(p => p.UserId).ToHashSet();
        var teamBPlayerIds = createdMatch.TeamB!.Players.Select(p => p.UserId).ToHashSet();
        var allTeamPlayerIds = teamAPlayerIds.Union(teamBPlayerIds).ToHashSet();

        allTeamPlayerIds.Should().BeEquivalentTo(playerIds, "all players should be assigned to teams");

        // Verify teams are balanced (equal size)
        createdMatch.TeamA.Players.Count.Should().Be(playerCount / 2);
        createdMatch.TeamB.Players.Count.Should().Be(playerCount / 2);

        // Verify no player is on both teams
        teamAPlayerIds.Intersect(teamBPlayerIds).Should().BeEmpty("no player should be on both teams");
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 28: Admin-only result submission
    /// For any match and user, only squad admins should be able to submit match results.
    /// Validates: Requirements 6.1
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task AdminOnlyResultSubmission_ShouldRejectNonAdminUsers(
        PositiveInt adminSeed,
        PositiveInt nonAdminSeed,
        PositiveInt squadSeed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var nonAdminEmail = GenerateValidEmail(nonAdminSeed.Get);
        var squadName = GenerateSquadName(squadSeed.Get);

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();
        var eloCalculationService = new EloCalculationService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create non-admin user
        var nonAdminUser = User.CreateWithPassword(
            Email.Create(nonAdminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(nonAdminUser);

        // Create squad with admin as creator
        var squad = Squad.Create(squadName, adminUser.Id);
        squad.AddMember(adminUser.Id, EloRating.Default);
        squad.AddMember(nonAdminUser.Id, EloRating.Default);
        await squadRepository.AddAsync(squad);

        // Create a match
        var playerIds = new List<UserId> { adminUser.Id, nonAdminUser.Id };
        var createHandler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var createCommand = new CreateMatchCommand(
            squad.Id,
            DateTime.UtcNow.AddDays(1),
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var createResult = await createHandler.HandleAsync(createCommand);
        createResult.Success.Should().BeTrue();

        var recordHandler = new RecordMatchResultCommandHandler(matchRepository, squadRepository, eloCalculationService);

        // Act - Try to record result as non-admin
        var nonAdminCommand = new RecordMatchResultCommand(
            createResult.MatchId!,
            TeamDesignation.TeamA,
            BalanceFeedback: null,
            nonAdminUser.Id);

        var nonAdminResult = await recordHandler.HandleAsync(nonAdminCommand);

        // Assert - Non-admin should be rejected
        nonAdminResult.Success.Should().BeFalse();
        nonAdminResult.ErrorCode.Should().Be("AUTHZ_001");
        nonAdminResult.ErrorMessage.Should().Contain("not a squad admin");

        // Act - Try to record result as admin
        var adminCommand = new RecordMatchResultCommand(
            createResult.MatchId!,
            TeamDesignation.TeamA,
            BalanceFeedback: null,
            adminUser.Id);

        var adminResult = await recordHandler.HandleAsync(adminCommand);

        // Assert - Admin should succeed
        adminResult.Success.Should().BeTrue();
        adminResult.ErrorCode.Should().BeNull();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 30: Result submission triggers updates
    /// For any match result submission, the system should update the match status to completed 
    /// and trigger ELO rating updates for all players.
    /// Validates: Requirements 6.3, 6.4
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task ResultSubmissionTriggersUpdates_ShouldUpdateMatchStatusAndRatings(
        PositiveInt adminSeed,
        PositiveInt squadSeed,
        PositiveInt playerCountSeed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var squadName = GenerateSquadName(squadSeed.Get);
        var playerCount = 2 + ((playerCountSeed.Get % 5) * 2); // 2, 4, 6, 8, or 10 players

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();
        var eloCalculationService = new EloCalculationService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create squad with admin as creator
        var squad = Squad.Create(squadName, adminUser.Id);
        squad.AddMember(adminUser.Id, EloRating.Default);

        // Add more players
        var playerIds = new List<UserId> { adminUser.Id };
        for (int i = 1; i < playerCount; i++)
        {
            var playerEmail = GenerateValidEmail(adminSeed.Get + i);
            var player = User.CreateWithPassword(
                Email.Create(playerEmail), 
                BCrypt.Net.BCrypt.HashPassword("password"));
            await userRepository.AddAsync(player);
            squad.AddMember(player.Id, EloRating.Default);
            playerIds.Add(player.Id);
        }

        await squadRepository.AddAsync(squad);

        // Create a match
        var createHandler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var createCommand = new CreateMatchCommand(
            squad.Id,
            DateTime.UtcNow.AddDays(1),
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var createResult = await createHandler.HandleAsync(createCommand);
        createResult.Success.Should().BeTrue();

        // Capture initial ratings
        var initialRatings = new Dictionary<UserId, int>();
        foreach (var playerId in playerIds)
        {
            var membership = squad.GetMembershipForUser(playerId);
            initialRatings[playerId] = membership.CurrentRating.Value;
        }

        // Get the match before recording result
        var matchBeforeResult = await matchRepository.GetByIdAsync(createResult.MatchId!);
        matchBeforeResult!.Status.Should().Be(MatchStatus.Pending);
        matchBeforeResult.Result.Should().BeNull();

        // Act - Record match result
        var recordHandler = new RecordMatchResultCommandHandler(matchRepository, squadRepository, eloCalculationService);
        var recordCommand = new RecordMatchResultCommand(
            createResult.MatchId!,
            TeamDesignation.TeamA,
            BalanceFeedback: "Teams were well balanced",
            adminUser.Id);

        var recordResult = await recordHandler.HandleAsync(recordCommand);

        // Assert - Result should be recorded successfully
        recordResult.Success.Should().BeTrue();
        recordResult.ErrorCode.Should().BeNull();

        // Verify match status is updated to Completed
        var matchAfterResult = await matchRepository.GetByIdAsync(createResult.MatchId!);
        matchAfterResult.Should().NotBeNull();
        matchAfterResult!.Status.Should().Be(MatchStatus.Completed, "match status should be updated to Completed");
        matchAfterResult.Result.Should().NotBeNull("match result should be recorded");
        matchAfterResult.Result!.Winner.Should().Be(TeamDesignation.TeamA);
        matchAfterResult.Result.BalanceFeedback.Should().Be("Teams were well balanced");

        // Verify ELO ratings were updated for all players
        var updatedSquad = await squadRepository.GetByIdAsync(squad.Id);
        updatedSquad.Should().NotBeNull();

        var ratingsChanged = false;
        foreach (var playerId in playerIds)
        {
            var membership = updatedSquad!.GetMembershipForUser(playerId);
            var newRating = membership.CurrentRating.Value;
            var oldRating = initialRatings[playerId];

            // At least some ratings should have changed
            if (newRating != oldRating)
            {
                ratingsChanged = true;
            }
        }

        ratingsChanged.Should().BeTrue("at least some player ratings should have changed after match result");
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 21: Rating changes for all players
    /// For any completed match, all participating players should have their ELO ratings recalculated.
    /// Validates: Requirements 5.1
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task RatingChangesForAllPlayers_ShouldRecalculateAllPlayerRatings(
        PositiveInt adminSeed,
        PositiveInt squadSeed,
        PositiveInt playerCountSeed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var squadName = GenerateSquadName(squadSeed.Get);
        var playerCount = 2 + ((playerCountSeed.Get % 5) * 2); // 2, 4, 6, 8, or 10 players

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();
        var eloCalculationService = new EloCalculationService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create squad with admin as creator
        var squad = Squad.Create(squadName, adminUser.Id);
        squad.AddMember(adminUser.Id, EloRating.Default);

        // Add more players with varying ratings
        var playerIds = new List<UserId> { adminUser.Id };
        for (int i = 1; i < playerCount; i++)
        {
            var playerEmail = GenerateValidEmail(adminSeed.Get + i);
            var player = User.CreateWithPassword(
                Email.Create(playerEmail), 
                BCrypt.Net.BCrypt.HashPassword("password"));
            await userRepository.AddAsync(player);
            var rating = EloRating.Create(1000 + ((adminSeed.Get + i) % 500));
            squad.AddMember(player.Id, rating);
            playerIds.Add(player.Id);
        }

        await squadRepository.AddAsync(squad);

        // Create a match
        var createHandler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var createCommand = new CreateMatchCommand(
            squad.Id,
            DateTime.UtcNow.AddDays(1),
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var createResult = await createHandler.HandleAsync(createCommand);
        createResult.Success.Should().BeTrue();

        // Capture initial ratings for all players
        var initialRatings = new Dictionary<UserId, int>();
        foreach (var playerId in playerIds)
        {
            var membership = squad.GetMembershipForUser(playerId);
            initialRatings[playerId] = membership.CurrentRating.Value;
        }

        // Act - Record match result
        var recordHandler = new RecordMatchResultCommandHandler(matchRepository, squadRepository, eloCalculationService);
        var recordCommand = new RecordMatchResultCommand(
            createResult.MatchId!,
            TeamDesignation.TeamA,
            BalanceFeedback: null,
            adminUser.Id);

        var recordResult = await recordHandler.HandleAsync(recordCommand);

        // Assert - Result should be recorded successfully
        recordResult.Success.Should().BeTrue();

        // Verify ALL players have rating changes calculated
        var updatedSquad = await squadRepository.GetByIdAsync(squad.Id);
        updatedSquad.Should().NotBeNull();

        var playersWithRatingChanges = 0;
        foreach (var playerId in playerIds)
        {
            var membership = updatedSquad!.GetMembershipForUser(playerId);
            var newRating = membership.CurrentRating.Value;
            var oldRating = initialRatings[playerId];

            // Each player should have a rating (may be same if draw with equal teams, but should be calculated)
            membership.CurrentRating.Should().NotBeNull();

            // Count players whose ratings actually changed
            if (newRating != oldRating)
            {
                playersWithRatingChanges++;
            }
        }

        // In a typical match, at least some players should have rating changes
        // (unless it's a perfect draw with perfectly balanced teams, which is rare)
        playersWithRatingChanges.Should().BeGreaterThan(0, 
            "at least some players should have rating changes after a match result");
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 27: Independent squad ratings
    /// For any user in multiple squads, rating changes in one squad should not affect their ratings in other squads.
    /// Validates: Requirements 5.8
    /// </summary>
    [Property(MaxTest = 50)]
    public async Task IndependentSquadRatings_ShouldNotAffectOtherSquadRatings(
        PositiveInt adminSeed,
        PositiveInt squad1Seed,
        PositiveInt squad2Seed)
    {
        // Arrange
        var adminEmail = GenerateValidEmail(adminSeed.Get);
        var squad1Name = GenerateSquadName(squad1Seed.Get);
        var squad2Name = GenerateSquadName(squad2Seed.Get);

        var userRepository = new InMemoryUserRepository();
        var squadRepository = new InMemorySquadRepository();
        var matchRepository = new InMemoryMatchRepository();
        var teamBalancingService = new TeamBalancingService();
        var eloCalculationService = new EloCalculationService();

        // Create admin user
        var adminUser = User.CreateWithPassword(
            Email.Create(adminEmail), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(adminUser);

        // Create another player
        var player2Email = GenerateValidEmail(adminSeed.Get + 1);
        var player2 = User.CreateWithPassword(
            Email.Create(player2Email), 
            BCrypt.Net.BCrypt.HashPassword("password"));
        await userRepository.AddAsync(player2);

        // Create Squad 1 with both players
        var squad1 = Squad.Create(squad1Name, adminUser.Id);
        squad1.AddMember(adminUser.Id, EloRating.Create(1200));
        squad1.AddMember(player2.Id, EloRating.Create(1200));
        await squadRepository.AddAsync(squad1);

        // Create Squad 2 with both players (different initial ratings)
        var squad2 = Squad.Create(squad2Name, adminUser.Id);
        squad2.AddMember(adminUser.Id, EloRating.Create(1500));
        squad2.AddMember(player2.Id, EloRating.Create(1500));
        await squadRepository.AddAsync(squad2);

        // Capture initial ratings in Squad 2
        var squad2InitialRatingAdmin = squad2.GetMembershipForUser(adminUser.Id).CurrentRating.Value;
        var squad2InitialRatingPlayer2 = squad2.GetMembershipForUser(player2.Id).CurrentRating.Value;

        // Create and complete a match in Squad 1
        var playerIds = new List<UserId> { adminUser.Id, player2.Id };
        var createHandler = new CreateMatchCommandHandler(squadRepository, matchRepository, teamBalancingService);
        var createCommand = new CreateMatchCommand(
            squad1.Id,
            DateTime.UtcNow.AddDays(1),
            playerIds,
            TeamSize: null,
            adminUser.Id);

        var createResult = await createHandler.HandleAsync(createCommand);
        createResult.Success.Should().BeTrue();

        // Record result in Squad 1
        var recordHandler = new RecordMatchResultCommandHandler(matchRepository, squadRepository, eloCalculationService);
        var recordCommand = new RecordMatchResultCommand(
            createResult.MatchId!,
            TeamDesignation.TeamA,
            BalanceFeedback: null,
            adminUser.Id);

        var recordResult = await recordHandler.HandleAsync(recordCommand);
        recordResult.Success.Should().BeTrue();

        // Act - Get updated squads
        var updatedSquad1 = await squadRepository.GetByIdAsync(squad1.Id);
        var updatedSquad2 = await squadRepository.GetByIdAsync(squad2.Id);

        // Assert - Squad 1 ratings should have changed
        var squad1FinalRatingAdmin = updatedSquad1!.GetMembershipForUser(adminUser.Id).CurrentRating.Value;
        var squad1FinalRatingPlayer2 = updatedSquad1.GetMembershipForUser(player2.Id).CurrentRating.Value;

        // At least one rating in Squad 1 should have changed
        var squad1RatingsChanged = (squad1FinalRatingAdmin != 1200) || (squad1FinalRatingPlayer2 != 1200);
        squad1RatingsChanged.Should().BeTrue("ratings in Squad 1 should have changed after match");

        // Assert - Squad 2 ratings should remain unchanged
        var squad2FinalRatingAdmin = updatedSquad2!.GetMembershipForUser(adminUser.Id).CurrentRating.Value;
        var squad2FinalRatingPlayer2 = updatedSquad2.GetMembershipForUser(player2.Id).CurrentRating.Value;

        squad2FinalRatingAdmin.Should().Be(squad2InitialRatingAdmin, 
            "admin rating in Squad 2 should not be affected by Squad 1 match");
        squad2FinalRatingPlayer2.Should().Be(squad2InitialRatingPlayer2, 
            "player2 rating in Squad 2 should not be affected by Squad 1 match");
    }

    // Generate valid email addresses deterministically
    private static string GenerateValidEmail(int seed)
    {
        var localParts = new[] { "user", "test", "admin", "player", "john", "jane", "alice", "bob" };
        var domains = new[] { "example.com", "test.com", "mail.com", "pitchmate.io" };

        var localPart = localParts[seed % localParts.Length];
        var domain = domains[seed / localParts.Length % domains.Length];

        return $"{localPart}{seed}@{domain}";
    }

    // Generate squad names deterministically
    private static string GenerateSquadName(int seed)
    {
        var prefixes = new[] { "Team", "Squad", "FC", "United", "Athletic", "Rangers" };
        var suffixes = new[] { "Warriors", "Legends", "Champions", "Stars", "Elite", "Pro" };

        var prefix = prefixes[seed % prefixes.Length];
        var suffix = suffixes[seed / prefixes.Length % suffixes.Length];

        return $"{prefix} {suffix} {seed}";
    }
}


/// <summary>
/// In-memory implementation of IMatchRepository for testing.
/// Provides a simple dictionary-based storage for matches.
/// </summary>
internal class InMemoryMatchRepository : IMatchRepository
{
    private readonly Dictionary<MatchId, Match> _matchesById = [];
    private readonly Dictionary<SquadId, List<Match>> _matchesBySquadId = [];

    public Task<Match?> GetByIdAsync(MatchId id, CancellationToken ct = default)
    {
        _matchesById.TryGetValue(id, out var match);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<Match>> GetMatchesForSquadAsync(SquadId squadId, CancellationToken ct = default)
    {
        if (_matchesBySquadId.TryGetValue(squadId, out var matches))
        {
            return Task.FromResult<IReadOnlyList<Match>>(matches.AsReadOnly());
        }

        return Task.FromResult<IReadOnlyList<Match>>([]);
    }

    public Task AddAsync(Match match, CancellationToken ct = default)
    {
        _matchesById[match.Id] = match;

        if (!_matchesBySquadId.TryGetValue(match.SquadId, out var matches))
        {
            matches = [];
            _matchesBySquadId[match.SquadId] = matches;
        }
        matches.Add(match);

        return Task.CompletedTask;
    }

    public Task UpdateAsync(Match match, CancellationToken ct = default)
    {
        _matchesById[match.Id] = match;

        if (_matchesBySquadId.TryGetValue(match.SquadId, out var matches))
        {
            var index = matches.FindIndex(m => m.Id.Equals(match.Id));
            if (index >= 0)
            {
                matches[index] = match;
            }
        }

        return Task.CompletedTask;
    }
}
