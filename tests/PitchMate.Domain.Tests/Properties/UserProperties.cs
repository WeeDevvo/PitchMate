using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.Properties;

public class UserProperties
{
    /// <summary>
    /// Feature: pitchmate-core, Property 8: Multiple squad memberships
    /// For any user and any set of squads, a user should be able to join multiple squads 
    /// and maintain separate memberships in each.
    /// Validates: Requirements 2.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void MultipleSquadMemberships_ShouldMaintainSeparateMemberships(
        PositiveInt squadCount,
        PositiveInt[] ratings)
    {
        // Guard against empty ratings array
        if (ratings == null || ratings.Length == 0)
            return; // Skip this test case
        
        // Arrange - Limit squad count to reasonable range
        var actualSquadCount = Math.Min(squadCount.Get % 10 + 1, ratings.Length);
        if (actualSquadCount < 1) actualSquadCount = 1;

        var user = User.CreateWithPassword(
            Email.Create("test@example.com"),
            "hashed_password");

        var squads = new List<(SquadId SquadId, EloRating Rating)>();
        for (int i = 0; i < actualSquadCount; i++)
        {
            var squadId = SquadId.NewId();
            var rating = EloRating.Create(400 + (ratings[i % ratings.Length].Get % 2000));
            squads.Add((squadId, rating));
        }

        // Act - Join multiple squads with different ratings
        foreach (var (squadId, rating) in squads)
        {
            user.JoinSquad(squadId, rating);
        }

        // Assert
        // 1. User should have memberships for all squads
        user.SquadMemberships.Should().HaveCount(squads.Count);

        // 2. Each squad should have a separate membership with the correct rating
        foreach (var (squadId, expectedRating) in squads)
        {
            var membership = user.GetMembershipForSquad(squadId);
            membership.Should().NotBeNull();
            membership.SquadId.Should().Be(squadId);
            membership.UserId.Should().Be(user.Id);
            membership.CurrentRating.Should().Be(expectedRating);
        }

        // 3. Updating rating in one squad should not affect others
        if (squads.Count >= 2)
        {
            var firstSquad = squads[0];
            var secondSquad = squads[1];
            var newRating = EloRating.Create(1500);

            user.UpdateRatingForSquad(firstSquad.SquadId, newRating);

            var updatedMembership = user.GetMembershipForSquad(firstSquad.SquadId);
            updatedMembership.CurrentRating.Should().Be(newRating);

            var unchangedMembership = user.GetMembershipForSquad(secondSquad.SquadId);
            unchangedMembership.CurrentRating.Should().Be(secondSquad.Rating);
        }
    }
}
