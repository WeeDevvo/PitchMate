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
            
            // Update member ratings in the squad_memberships table (owned by User entities)
            await SaveMemberRatingsAsync(squad, ct);
            
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
        // Clear all tracked Dictionary entities to avoid conflicts
        var trackedDictionaries = _context.ChangeTracker.Entries<Dictionary<string, object>>()
            .Where(e => e.State != Microsoft.EntityFrameworkCore.EntityState.Detached)
            .ToList();
        
        foreach (var entry in trackedDictionaries)
        {
            entry.State = Microsoft.EntityFrameworkCore.EntityState.Detached;
        }

        // Get existing admin records without tracking
        var existingAdmins = await _context.Set<Dictionary<string, object>>("squad_admins")
            .AsNoTracking()
            .Where(d => (Guid)d["squad_id"] == squad.Id.Value)
            .ToListAsync(ct);

        var existingAdminUserIds = existingAdmins.Select(d => (Guid)d["user_id"]).ToHashSet();
        var currentAdminIds = squad.AdminIds.Select(a => a.Value).ToHashSet();

        // Determine which admins to add and which to remove
        var adminsToRemove = existingAdminUserIds.Except(currentAdminIds).ToList();
        var adminsToAdd = currentAdminIds.Except(existingAdminUserIds).ToList();

        // Remove admins that are no longer in the list
        foreach (var adminToRemove in adminsToRemove)
        {
            var recordToRemove = existingAdmins.First(d => (Guid)d["user_id"] == adminToRemove);
            // Attach the entity so EF Core can track it for deletion
            _context.Set<Dictionary<string, object>>("squad_admins").Attach(recordToRemove);
            _context.Set<Dictionary<string, object>>("squad_admins").Remove(recordToRemove);
        }

        // Add new admins
        foreach (var adminToAdd in adminsToAdd)
        {
            var adminRecord = new Dictionary<string, object>
            {
                ["squad_id"] = squad.Id.Value,
                ["user_id"] = adminToAdd
            };
            
            await _context.Set<Dictionary<string, object>>("squad_admins").AddAsync(adminRecord, ct);
        }
    }

    /// <summary>
    /// Saves updated member ratings to the squad_memberships table (owned by User entities).
    /// </summary>
    private async Task SaveMemberRatingsAsync(Squad squad, CancellationToken ct)
    {
        // Load all users who are members of this squad
        var memberUserIds = squad.Members.Select(m => m.UserId).ToList();
        var users = await _context.Users
            .Include(u => u.SquadMemberships)
            .Where(u => memberUserIds.Contains(u.Id))
            .ToListAsync(ct);

        // Update each user's membership rating
        foreach (var user in users)
        {
            var squadMembership = squad.Members.FirstOrDefault(m => m.UserId == user.Id);
            if (squadMembership != null)
            {
                // Find the corresponding membership in the user's collection
                var userMembershipIndex = user.SquadMemberships
                    .ToList()
                    .FindIndex(m => m.SquadId == squad.Id);
                
                if (userMembershipIndex >= 0)
                {
                    // Use reflection to update the membership in the user's collection
                    var squadMembershipsField = typeof(Domain.Entities.User).GetField("_squadMemberships", 
                        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                    
                    if (squadMembershipsField != null)
                    {
                        var membershipsList = (List<SquadMembership>)squadMembershipsField.GetValue(user)!;
                        membershipsList[userMembershipIndex] = squadMembership;
                        
                        // Mark the user as modified so EF Core saves the changes
                        _context.Users.Update(user);
                    }
                }
            }
        }
    }
}
