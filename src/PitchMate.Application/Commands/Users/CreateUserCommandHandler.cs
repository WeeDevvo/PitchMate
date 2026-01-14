using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;
using BCrypt.Net;

namespace PitchMate.Application.Commands.Users;

/// <summary>
/// Handler for CreateUserCommand.
/// Validates email format, checks for duplicates, hashes password, and persists the user.
/// </summary>
public class CreateUserCommandHandler
{
    private readonly IUserRepository _userRepository;

    public CreateUserCommandHandler(IUserRepository userRepository)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
    }

    /// <summary>
    /// Handles the CreateUserCommand.
    /// </summary>
    /// <param name="command">The command containing email and password.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<CreateUserResult> HandleAsync(CreateUserCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        // Validate email format
        Email email;
        try
        {
            email = Email.Create(command.Email);
        }
        catch (ArgumentException ex)
        {
            return new CreateUserResult(
                UserId: null!,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: ex.Message);
        }

        // Check for duplicate email
        var existingUser = await _userRepository.GetByEmailAsync(email, ct);
        if (existingUser != null)
        {
            return new CreateUserResult(
                UserId: null!,
                Success: false,
                ErrorCode: "AUTH_002",
                ErrorMessage: "Email already exists.");
        }

        // Validate password
        if (string.IsNullOrWhiteSpace(command.Password))
        {
            return new CreateUserResult(
                UserId: null!,
                Success: false,
                ErrorCode: "VAL_002",
                ErrorMessage: "Password cannot be empty.");
        }

        if (command.Password.Length < 8)
        {
            return new CreateUserResult(
                UserId: null!,
                Success: false,
                ErrorCode: "VAL_002",
                ErrorMessage: "Password must be at least 8 characters long.");
        }

        // Hash password using BCrypt
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(command.Password);

        // Create user entity
        var user = User.CreateWithPassword(email, passwordHash);

        // Persist via repository
        await _userRepository.AddAsync(user, ct);

        return new CreateUserResult(
            UserId: user.Id,
            Success: true);
    }
}
