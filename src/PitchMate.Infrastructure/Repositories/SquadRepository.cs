using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;
using PitchMate.Infrastructure.Data;

namespace PitchMate.Infrastructure.Repositories;

/// <summary>
/// EF Core implementation of ISquadRepository.
/// Handles persistence operations for Squad aggregate with related entities (members, admins).
/// </summary>
public class SquadRepository : ISquadRepository
{
    private readonly PitchMateDbContext _context;

    public SquadRepository(PitchMateDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    /// <inheritdoc />
    public async Task<Squad?> GetByIdAsync(SquadId id, CancellationToken ct = default)
    {
        try
        {
            var squad = await _context.Squads
                .FirstOrDefaultAsync(s => s.Id == id, ct);

            if (squad != null)
            {
                // Load admin IDs from the join table
                await LoadAdminIdsAsync(squad, ct);
                
                // Load members from squad_memberships table
                await LoadMembersAsync(squad, ct);
            }

            return squad;
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving squad by ID {id.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<Squad>> GetSquadsForUserAsync(UserId userId, CancellationToken ct = default)
    {
        try
        {
            // Query users to find squad memberships, then load corresponding squads
            var user = await _context.Users
                .Include(u => u.SquadMemberships)
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user == null)
            {
                return Array.Empty<Squad>().ToList().AsReadOnly();
            }

            var squadIds = user.SquadMemberships.Select(m => m.SquadId).ToList();
            
            var squads = new List<Squad>();
            foreach (var squadId in squadIds)
            {
                var squad = await GetByIdAsync(squadId, ct);
                if (squad != null)
                {
                    squads.Add(squad);
                }
            }

            return squads.AsReadOnly();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving squads for user {userId.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task AddAsync(Squad squad, CancellationToken ct = default)
    {
        try
        {
            await _context.Squads.AddAsync(squad, ct);
            
            // Persist admin relationships in the join table
            await SaveAdminIdsAsync(squad, ct);
            
            await _context.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Error adding squad {squad.Id.Value}. This may be due to a constraint violation.", ex);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error adding squad {squad.Id.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task UpdateAsync(Squad squad, CancellationToken ct = default)
    {
        try
        {
            _context.Squads.Update(squad);
            
            // Update admin relationships in the join table
            await SaveAdminIdsAsync(squad, ct);
            
            await _context.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            throw new InvalidOperationException($"Concurrency error updating squad {squad.Id.Value}. The squad may have been modified by another process.", ex);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Error updating squad {squad.Id.Value}. This may be due to a constraint violation.", ex);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error updating squad {squad.Id.Value}.", ex);
        }
    }

    /// <summary>
    /// Loads admin IDs from the squad_admins join table into the Squad entity.
    /// </summary>
    private async Task LoadAdminIdsAsync(Squad squad, CancellationToken ct)
    {
        var adminRecords = await _context.Set<Dictionary<string, object>>("squad_admins")
            .Where(d => (Guid)d["squad_id"] == squad.Id.Value)
            .ToListAsync(ct);

        // Use reflection to populate the private _adminIds field
        var adminIdsField = typeof(Squad).GetField("_adminIds", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        
        if (adminIdsField != null)
        {
            var adminIdsList = (List<UserId>)adminIdsField.GetValue(squad)!;
            adminIdsList.Clear();
            
            foreach (var record in adminRecords)
            {
                var userId = new UserId((Guid)record["user_id"]);
                adminIdsList.Add(userId);
            }
        }
    }

    /// <summary>
    /// Loads members from the squad_memberships table into the Squad entity.
    /// </summary>
    private async Task LoadMembersAsync(Squad squad, CancellationToken ct)
    {
        // Query users who have memberships for this squad
        var users = await _context.Users
            .Include(u => u.SquadMemberships)
            .Where(u => u.SquadMemberships.Any(m => m.SquadId == squad.Id))
            .ToListAsync(ct);

        var memberships = users
            .SelectMany(u => u.SquadMemberships)
            .Where(m => m.SquadId == squad.Id)
            .ToList();

        // Use reflection to populate the private _members field
        var membersField = typeof(Squad).GetField("_members", 
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        
        if (membersField != null)
        {
            var membersList = (List<SquadMembership>)membersField.GetValue(squad)!;
            membersList.Clear();
            membersList.AddRange(memberships);
        }
    }

    /// <summary>
    /// Saves admin IDs to the squad_admins join table.
    /// </summary>
    private async Task SaveAdminIdsAsync(Squad squad, CancellationToken ct)
    {
        // Remove existing admin records
        var existingAdmins = await _context.Set<Dictionary<string, object>>("squad_admins")
            .Where(d => (Guid)d["squad_id"] == squad.Id.Value)
            .ToListAsync(ct);
        
        _context.Set<Dictionary<string, object>>("squad_admins").RemoveRange(existingAdmins);

        // Add current admin records
        foreach (var adminId in squad.AdminIds)
        {
            var adminRecord = new Dictionary<string, object>
            {
                ["squad_id"] = squad.Id.Value,
                ["user_id"] = adminId.Value
            };
            
            await _context.Set<Dictionary<string, object>>("squad_admins").AddAsync(adminRecord, ct);
        }
    }
}
