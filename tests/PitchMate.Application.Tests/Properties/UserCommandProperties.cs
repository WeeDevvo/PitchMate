using FsCheck;
using FsCheck.Xunit;
using FluentAssertions;
using PitchMate.Application.Commands.Users;
using PitchMate.Application.Services;
using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Tests.Properties;

/// <summary>
/// Property-based tests for user management commands.
/// Tests universal properties that should hold for all valid inputs.
/// </summary>
public class UserCommandProperties
{
    /// <summary>
    /// Feature: pitchmate-core, Property 1: Valid registration creates user account
    /// For any valid email and password combination, creating a user account should result 
    /// in a persisted user with those credentials that can subsequently authenticate.
    /// Validates: Requirements 1.1, 1.3
    /// </summary>
    [Property(MaxTest = 100)]
    public async Task ValidRegistrationCreatesUserAccount(PositiveInt emailSeed, PositiveInt passwordSeed)
    {
        // Arrange
        var email = GenerateValidEmail(emailSeed.Get);
        var password = GenerateValidPassword(passwordSeed.Get);
        
        var repository = new InMemoryUserRepository();
        var handler = new CreateUserCommandHandler(repository);
        var command = new CreateUserCommand(email, password);

        // Act
        var result = await handler.HandleAsync(command);

        // Assert
        result.Success.Should().BeTrue();
        result.UserId.Should().NotBeNull();
        result.ErrorCode.Should().BeNull();
        result.ErrorMessage.Should().BeNull();

        // Verify user was persisted
        var persistedUser = await repository.GetByEmailAsync(Email.Create(email));
        persistedUser.Should().NotBeNull();
        persistedUser!.Email.Value.Should().Be(email.ToLowerInvariant());
        persistedUser.PasswordHash.Should().NotBeNullOrEmpty();
        persistedUser.GoogleId.Should().BeNull();

        // Verify password hash is valid (BCrypt should verify)
        var passwordVerifies = BCrypt.Net.BCrypt.Verify(password, persistedUser.PasswordHash);
        passwordVerifies.Should().BeTrue();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 2: Duplicate email rejection
    /// For any existing user email, attempting to register another user with the same email 
    /// should be rejected with an appropriate error.
    /// Validates: Requirements 1.2
    /// </summary>
    [Property(MaxTest = 100)]
    public async Task DuplicateEmailRejection_ShouldRejectSecondRegistrationWithSameEmail(
        PositiveInt emailSeed, 
        PositiveInt password1Seed, 
        PositiveInt password2Seed)
    {
        // Arrange
        var email = GenerateValidEmail(emailSeed.Get);
        var password1 = GenerateValidPassword(password1Seed.Get);
        var password2 = GenerateValidPassword(password2Seed.Get);
        
        var repository = new InMemoryUserRepository();
        var handler = new CreateUserCommandHandler(repository);
        
        // Create first user successfully
        var firstCommand = new CreateUserCommand(email, password1);
        var firstResult = await handler.HandleAsync(firstCommand);
        firstResult.Success.Should().BeTrue();

        // Act - Try to create second user with same email
        var secondCommand = new CreateUserCommand(email, password2);
        var secondResult = await handler.HandleAsync(secondCommand);

        // Assert - Second registration should be rejected
        secondResult.Success.Should().BeFalse();
        secondResult.ErrorCode.Should().Be("AUTH_002");
        secondResult.ErrorMessage.Should().Contain("Email already exists");
        
        // Verify only one user exists in repository
        var users = await repository.GetByEmailAsync(Email.Create(email));
        users.Should().NotBeNull();
        users!.Id.Should().Be(firstResult.UserId);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 3: Invalid credentials rejection
    /// For any user account, attempting to authenticate with incorrect credentials 
    /// should be rejected and not issue a token.
    /// Validates: Requirements 1.4
    /// </summary>
    [Property(MaxTest = 100)]
    public async Task InvalidCredentialsRejection_ShouldRejectAuthenticationWithWrongPassword(
        PositiveInt emailSeed, 
        PositiveInt correctPasswordSeed, 
        PositiveInt wrongPasswordSeed)
    {
        // Arrange
        var email = GenerateValidEmail(emailSeed.Get);
        var correctPassword = GenerateValidPassword(correctPasswordSeed.Get);
        var wrongPassword = GenerateValidPassword(wrongPasswordSeed.Get);
        
        // Ensure passwords are different
        if (correctPassword == wrongPassword)
        {
            wrongPassword = wrongPassword + "X";
        }
        
        var repository = new InMemoryUserRepository();
        var jwtService = new JwtTokenService("ThisIsAVerySecureSecretKeyForTesting12345");
        
        // Create user
        var createHandler = new CreateUserCommandHandler(repository);
        var createCommand = new CreateUserCommand(email, correctPassword);
        var createResult = await createHandler.HandleAsync(createCommand);
        createResult.Success.Should().BeTrue();

        // Act - Try to authenticate with wrong password
        var authHandler = new AuthenticateUserCommandHandler(repository, jwtService);
        var authCommand = new AuthenticateUserCommand(email, wrongPassword);
        var authResult = await authHandler.HandleAsync(authCommand);

        // Assert - Authentication should be rejected
        authResult.Success.Should().BeFalse();
        authResult.ErrorCode.Should().Be("AUTH_001");
        authResult.ErrorMessage.Should().Contain("Invalid credentials");
        authResult.Token.Should().BeNull();
        authResult.UserId.Should().BeNull();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 4: Google OAuth user creation
    /// For any new Google ID, authenticating via Google OAuth should create a user account 
    /// linked to that Google identity.
    /// Validates: Requirements 1.6
    /// </summary>
    [Property(MaxTest = 100)]
    public async Task GoogleOAuthUserCreation_ShouldCreateNewUserForFirstTimeGoogleAuth(
        PositiveInt googleIdSeed, 
        PositiveInt emailSeed)
    {
        // Arrange
        var googleId = $"google_{googleIdSeed.Get}";
        var email = GenerateValidEmail(emailSeed.Get);
        var googleToken = $"mock_token_{googleIdSeed.Get}";
        
        var repository = new InMemoryUserRepository();
        var jwtService = new JwtTokenService("ThisIsAVerySecureSecretKeyForTesting12345");
        var googleValidator = new MockGoogleTokenValidator(googleId, email);
        
        var handler = new AuthenticateWithGoogleCommandHandler(repository, jwtService, googleValidator);
        var command = new AuthenticateWithGoogleCommand(googleToken);

        // Act - First time Google authentication
        var result = await handler.HandleAsync(command);

        // Assert - Should create new user
        result.Success.Should().BeTrue();
        result.UserId.Should().NotBeNull();
        result.Token.Should().NotBeNullOrEmpty();
        result.IsNewUser.Should().BeTrue();
        result.ErrorCode.Should().BeNull();

        // Verify user was persisted with Google ID
        var persistedUser = await repository.GetByGoogleIdAsync(googleId);
        persistedUser.Should().NotBeNull();
        persistedUser!.Email.Value.Should().Be(email.ToLowerInvariant());
        persistedUser.GoogleId.Should().Be(googleId);
        persistedUser.PasswordHash.Should().BeNull();

        // Act - Second time Google authentication (existing user)
        var secondResult = await handler.HandleAsync(command);

        // Assert - Should return existing user
        secondResult.Success.Should().BeTrue();
        secondResult.UserId.Should().Be(persistedUser.Id);
        secondResult.Token.Should().NotBeNullOrEmpty();
        secondResult.IsNewUser.Should().BeFalse();
    }

    // Generate valid email addresses deterministically
    private static string GenerateValidEmail(int seed)
    {
        var localParts = new[] { "user", "test", "admin", "player", "john.doe", "jane_smith", "alice", "bob" };
        var domains = new[] { "example.com", "test.com", "mail.com", "pitchmate.io" };
        
        var localPart = localParts[seed % localParts.Length];
        var domain = domains[(seed / localParts.Length) % domains.Length];
        
        return $"{localPart}{seed}@{domain}";
    }

    // Generate valid passwords (at least 8 characters)
    private static string GenerateValidPassword(int seed)
    {
        var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
        var random = new Random(seed);
        var length = 8 + (seed % 13); // 8-20 characters
        
        return new string(Enumerable.Range(0, length)
            .Select(_ => chars[random.Next(chars.Length)])
            .ToArray());
    }
}

/// <summary>
/// In-memory implementation of IUserRepository for testing.
/// Provides a simple dictionary-based storage for users.
/// </summary>
internal class InMemoryUserRepository : IUserRepository
{
    private readonly Dictionary<UserId, User> _usersById = new();
    private readonly Dictionary<string, User> _usersByEmail = new();
    private readonly Dictionary<string, User> _usersByGoogleId = new();

    public Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default)
    {
        _usersById.TryGetValue(id, out var user);
        return Task.FromResult(user);
    }

    public Task<User?> GetByEmailAsync(Email email, CancellationToken ct = default)
    {
        _usersByEmail.TryGetValue(email.Value, out var user);
        return Task.FromResult(user);
    }

    public Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default)
    {
        _usersByGoogleId.TryGetValue(googleId, out var user);
        return Task.FromResult(user);
    }

    public Task AddAsync(User user, CancellationToken ct = default)
    {
        _usersById[user.Id] = user;
        _usersByEmail[user.Email.Value] = user;
        
        if (user.GoogleId != null)
        {
            _usersByGoogleId[user.GoogleId] = user;
        }

        return Task.CompletedTask;
    }

    public Task UpdateAsync(User user, CancellationToken ct = default)
    {
        _usersById[user.Id] = user;
        _usersByEmail[user.Email.Value] = user;
        
        if (user.GoogleId != null)
        {
            _usersByGoogleId[user.GoogleId] = user;
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// Mock implementation of IGoogleTokenValidator for testing.
/// Returns predefined Google user info for any token.
/// </summary>
internal class MockGoogleTokenValidator : IGoogleTokenValidator
{
    private readonly string _googleId;
    private readonly string _email;

    public MockGoogleTokenValidator(string googleId, string email)
    {
        _googleId = googleId;
        _email = email;
    }

    public Task<GoogleUserInfo?> ValidateTokenAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return Task.FromResult<GoogleUserInfo?>(null);
        }

        return Task.FromResult<GoogleUserInfo?>(new GoogleUserInfo(_googleId, _email));
    }
}
