using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;
using PitchMate.Infrastructure.Data;

namespace PitchMate.Infrastructure.Repositories;

/// <summary>
/// EF Core implementation of IUserRepository.
/// Handles persistence operations for User aggregate with graceful error handling.
/// </summary>
public class UserRepository : IUserRepository
{
    private readonly PitchMateDbContext _context;

    public UserRepository(PitchMateDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    /// <inheritdoc />
    public async Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default)
    {
        try
        {
            return await _context.Users
                .Include(u => u.SquadMemberships)
                .FirstOrDefaultAsync(u => u.Id == id, ct);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving user by ID {id.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task<User?> GetByEmailAsync(Email email, CancellationToken ct = default)
    {
        try
        {
            return await _context.Users
                .Include(u => u.SquadMemberships)
                .FirstOrDefaultAsync(u => u.Email == email, ct);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving user by email {email.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default)
    {
        try
        {
            return await _context.Users
                .Include(u => u.SquadMemberships)
                .FirstOrDefaultAsync(u => u.GoogleId == googleId, ct);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error retrieving user by Google ID {googleId}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task AddAsync(User user, CancellationToken ct = default)
    {
        try
        {
            await _context.Users.AddAsync(user, ct);
            await _context.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Error adding user {user.Id.Value}. This may be due to a duplicate email or constraint violation.", ex);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error adding user {user.Id.Value}.", ex);
        }
    }

    /// <inheritdoc />
    public async Task UpdateAsync(User user, CancellationToken ct = default)
    {
        try
        {
            _context.Users.Update(user);
            await _context.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            throw new InvalidOperationException($"Concurrency error updating user {user.Id.Value}. The user may have been modified by another process.", ex);
        }
        catch (DbUpdateException ex)
        {
            throw new InvalidOperationException($"Error updating user {user.Id.Value}. This may be due to a constraint violation.", ex);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Error updating user {user.Id.Value}.", ex);
        }
    }
}
