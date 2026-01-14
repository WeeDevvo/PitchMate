using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;
using PitchMate.Infrastructure.Data;

namespace PitchMate.Infrastructure.Repositories;

/// <summary>
/// EF Core implementation of IMatchRepository.
/// Handles persistence operations for Match aggregate with related entities (players, teams, result).
/// </summary>
public class MatchRepository : IMatchRepository
{
    private readonly PitchMateDbContext _context;

    public MatchRepository(PitchMateDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    /// <inheritdoc />
    public async Task<Match?> GetByIdAsync(MatchId id, CancellationToken ct = default)
    {
        try
        {
            var match = await _context.Matches
                .Include(m => m.Players)
                .Include(m => m.Result)
                .FirstOrDefaultAsync(m => m.Id == id, ct);

            if (match != null)
            {
                // Reconstruct teams from match_players table
                ReconstructTeams(match);
            }

            return match;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving match by ID {id.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<Match>> GetMatchesForSquadAsync(SquadId squadId, CancellationToken ct = default)
    {
        try
        {
            var matches = await _context.Matches
                .Include(m => m.Players)
                .Include(m => m.Result)
                .Where(m => m.SquadId == squadId)
                .OrderByDescending(m => m.ScheduledAt)
                .ToListAsync(ct);

            // Reconstruct teams for each match
            foreach (var match in matches)
            {
                ReconstructTeams(match);
            }

            return matches.AsReadOnly();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving matches for squad {squadId.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task AddAsync(Match match, CancellationToken ct = default)
    {
        try
        {
            await _context.Matches.AddAsync(match, ct);
            
            // Save team designations if teams have been assigned
            SaveTeamDesignations(match);
            
            await _context.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Error adding match {match.Id.Value}. This may be due to a constraint violation.", ex);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error adding match {match.Id.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task UpdateAsync(Match match, CancellationToken ct = default)
    {
        try
        {
            _context.Matches.Update(match);
            
            // Update team designations if teams have been assigned
            SaveTeamDesignations(match);
            
            await _context.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            throw new InvalidOperationException($"Concurrency error updating match {match.Id.Value}. The match may have been modified by another process.", ex);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Error updating match {match.Id.Value}. This may be due to a constraint violation.", ex);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error updating match {match.Id.Value}.", ex);
        }
    }

    /// <summary>
    /// Reconstructs Team objects from the match_players by reading team designations from shadow properties.
    /// </summary>
    private void ReconstructTeams(Match match)
    {
        var teamAPlayers = new List<MatchPlayer>();
        var teamBPlayers = new List<MatchPlayer>();

        // Get the entity entry to access shadow properties
        var matchEntry = _context.Entry(match);
        var playersCollection = matchEntry.Collection(nameof(Match.Players));
        
        foreach (var player in match.Players)
        {
            // Try to get the team designation from the shadow property
            var playerEntry = _context.Entry(player);
            var teamDesignation = playerEntry.Property<string?>("TeamDesignation").CurrentValue;

            if (teamDesignation == "TeamA")
            {
                teamAPlayers.Add(player);
            }
            else if (teamDesignation == "TeamB")
            {
                teamBPlayers.Add(player);
            }
        }

        // Only reconstruct teams if they have been assigned
        if (teamAPlayers.Count > 0 && teamBPlayers.Count > 0)
        {
            var teamA = Team.Create(teamAPlayers);
            var teamB = Team.Create(teamBPlayers);

            // Use reflection to set the private fields
            var teamAField = typeof(Match).GetField("_teamA", 
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            var teamBField = typeof(Match).GetField("_teamB", 
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

            teamAField?.SetValue(match, teamA);
            teamBField?.SetValue(match, teamB);
        }
    }

    /// <summary>
    /// Saves team designations to shadow properties on match_players.
    /// </summary>
    private void SaveTeamDesignations(Match match)
    {
        if (match.TeamA == null || match.TeamB == null)
        {
            // Teams haven't been assigned yet
            return;
        }

        // Set TeamA designations
        foreach (var player in match.TeamA.Players)
        {
            var matchPlayer = match.Players.FirstOrDefault(p => p.UserId == player.UserId);
            if (matchPlayer != null)
            {
                var playerEntry = _context.Entry(matchPlayer);
                playerEntry.Property<string?>("TeamDesignation").CurrentValue = "TeamA";
            }
        }

        // Set TeamB designations
        foreach (var player in match.TeamB.Players)
        {
            var matchPlayer = match.Players.FirstOrDefault(p => p.UserId == player.UserId);
            if (matchPlayer != null)
            {
                var playerEntry = _context.Entry(matchPlayer);
                playerEntry.Property<string?>("TeamDesignation").CurrentValue = "TeamB";
            }
        }
    }
}
