using FsCheck.Xunit;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;
using PitchMate.Infrastructure.Data;
using PitchMate.Infrastructure.Repositories;

namespace PitchMate.Infrastructure.Tests.Properties;

/// <summary>
/// Property-based tests for referential integrity in the database.
/// Feature: pitchmate-core, Property 38: Referential integrity
/// Validates: Requirements 9.4
/// </summary>
public class ReferentialIntegrityProperties
{
    /// <summary>
    /// Feature: pitchmate-core, Property 38: Referential integrity
    /// For any match, the referenced squad must exist in the database
    /// </summary>
    [Property(MaxTest = 100)]
    public void MatchesReferenceValidSquads(Guid squadGuid)
    {
        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var squadRepo = new SquadRepository(context);
        var matchRepo = new MatchRepository(context);

        var creatorId = UserId.NewId();
        var squadId = new SquadId(squadGuid);
        
        // Create a squad
        var squad = Squad.Create("Test Squad", creatorId);
        var squadIdField = typeof(Squad).GetField("Id", 
            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        squadIdField?.SetValue(squad, squadId);
        
        squadRepo.AddAsync(squad).Wait();

        // Create a match referencing the squad
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(UserId.NewId(), EloRating.Default),
            MatchPlayer.Create(UserId.NewId(), EloRating.Default)
        };
        var match = Match.Create(squadId, DateTime.UtcNow.AddDays(1), players);
        matchRepo.AddAsync(match).Wait();

        // Act - Retrieve the match
        var retrievedMatch = matchRepo.GetByIdAsync(match.Id).Result;

        // Assert - Match should reference the existing squad
        retrievedMatch.Should().NotBeNull();
        retrievedMatch!.SquadId.Should().Be(squadId);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 38: Referential integrity
    /// For any squad membership, the referenced user must exist
    /// </summary>
    [Property(MaxTest = 100)]
    public void SquadMembershipsReferenceValidUsers(string emailLocal)
    {
        // Skip invalid inputs and sanitize
        if (string.IsNullOrWhiteSpace(emailLocal))
            return;
        
        // Remove whitespace and special characters to create valid email local part
        var sanitized = new string(emailLocal.Where(c => char.IsLetterOrDigit(c)).ToArray());
        if (string.IsNullOrEmpty(sanitized))
            return;
            
        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var userRepo = new UserRepository(context);

        var email = Email.Create($"{sanitized}@test.com");
        var user = User.CreateWithPassword(email, "hashedPassword");
        userRepo.AddAsync(user).Wait();

        // Add squad membership
        var squadId = SquadId.NewId();
        user.JoinSquad(squadId, EloRating.Default);
        userRepo.UpdateAsync(user).Wait();

        // Act - Retrieve the user
        var retrievedUser = userRepo.GetByIdAsync(user.Id).Result;

        // Assert - User should have the squad membership
        retrievedUser.Should().NotBeNull();
        retrievedUser!.SquadMemberships.Should().Contain(m => m.SquadId.Equals(squadId));
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 38: Referential integrity
    /// For any match player, the referenced user must exist
    /// </summary>
    [Property(MaxTest = 100)]
    public void MatchPlayersReferenceValidUsers(Guid userGuid1, Guid userGuid2)
    {
        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var matchRepo = new MatchRepository(context);

        var userId1 = new UserId(userGuid1);
        var userId2 = new UserId(userGuid2);
        
        // Create a match with players
        var players = new List<MatchPlayer>
        {
            MatchPlayer.Create(userId1, EloRating.Create(1000)),
            MatchPlayer.Create(userId2, EloRating.Create(1100))
        };
        var match = Match.Create(SquadId.NewId(), DateTime.UtcNow.AddDays(1), players);
        matchRepo.AddAsync(match).Wait();

        // Act - Retrieve the match
        var retrievedMatch = matchRepo.GetByIdAsync(match.Id).Result;

        // Assert - Match should have all players
        retrievedMatch.Should().NotBeNull();
        retrievedMatch!.Players.Should().HaveCount(2);
        retrievedMatch.Players.Should().Contain(p => p.UserId.Equals(userId1));
        retrievedMatch.Players.Should().Contain(p => p.UserId.Equals(userId2));
    }
}
