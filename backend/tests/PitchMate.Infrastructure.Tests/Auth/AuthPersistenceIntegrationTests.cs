using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Auth.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Integration tests for the auth EF Core mappings, exercised against a <em>real</em> PostgreSQL
/// instance via the shared Testcontainers fixture — never the EF in-memory provider or SQLite, so
/// they observe actual PostgreSQL unique-constraint and transaction semantics. Each test runs
/// against its own freshly created, empty database on the shared server (schema created from the
/// production model), so it is isolated from every other test.
/// <para>
/// The tests confirm that the unique <c>(Provider, ProviderUserId)</c> and
/// <c>RefreshToken.TokenHash</c> indexes surface from the production save pipeline as the
/// Application-layer <see cref="DuplicateKeyException"/> (Requirements 1.3, 1.10, 2.3, 10.3), and
/// that a multi-row registration and a multi-row erasure roll back atomically on an induced
/// mid-operation failure, leaving no partial persistence (Requirements 2.1, 14.7).
/// </para>
/// <para>Validates: Requirements 1.3, 1.10, 2.3, 10.3, 2.1, 14.7.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AuthPersistenceIntegrationTests
{
    private static readonly DateTimeOffset TokenExpiry =
        FakeTimeProvider.DefaultNow.AddDays(30);

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public AuthPersistenceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirements 1.3, 1.10, 2.3, 10.3 — the unique (Provider, ProviderUserId) index rejects a
    // second identity sharing the pair, and that rejection surfaces from the save pipeline as the
    // Application-layer DuplicateKeyException (not a raw provider exception).
    /// <summary>
    /// Persisting a second <see cref="AuthIdentity"/> whose <c>(Provider, ProviderUserId)</c> pair
    /// already exists is rejected: the save surfaces a <see cref="DuplicateKeyException"/> and the
    /// second (otherwise valid) user is not persisted.
    /// </summary>
    [Fact]
    public async Task DuplicateProviderKey_SurfacesDuplicateKeyExceptionAndPersistsNothing()
    {
        await WithAuthSchemaAsync(async connectionString =>
        {
            // Seed a Password identity keyed on (Password, "dup@example.com").
            await using (var seed = CreateContext(connectionString))
            {
                var userA = User.Create("Alice", "dup@example.com");
                await new EfUserRepository(seed).AddAsync(userA, CancellationToken.None);
                await new EfAuthIdentityRepository(seed).AddAsync(
                    AuthIdentity.ForPassword(userA.Id, "dup@example.com", PasswordCredential.Create("hash-A")),
                    CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // A distinct user with a colliding Password identity (same normalised email as the key).
            Guid userBId;
            await using (var context = CreateContext(connectionString))
            {
                var userB = User.Create("Bob", "bob@example.com");
                userBId = userB.Id;
                await new EfUserRepository(context).AddAsync(userB, CancellationToken.None);
                await new EfAuthIdentityRepository(context).AddAsync(
                    AuthIdentity.ForPassword(userB.Id, "dup@example.com", PasswordCredential.Create("hash-B")),
                    CancellationToken.None);

                await Assert.ThrowsAsync<DuplicateKeyException>(
                    () => new UnitOfWork(context).SaveChangesAsync(CancellationToken.None));
            }

            // Atomic: the failed save persisted none of the second user.
            await using var verify = CreateContext(connectionString);
            var storedB = await verify.Set<User>()
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(u => u.Id == userBId);
            Assert.Null(storedB);

            // Exactly one identity holds the contested key.
            var withKey = await verify.Set<AuthIdentity>()
                .IgnoreQueryFilters()
                .CountAsync(i => i.Provider == AuthProvider.Password && i.ProviderUserId == "dup@example.com");
            Assert.Equal(1, withKey);
        });
    }

    // Requirements 1.3, 9.6 — the unique RefreshToken.TokenHash index rejects a second token sharing
    // the hash, surfacing as the Application-layer DuplicateKeyException.
    /// <summary>
    /// Persisting a second <see cref="RefreshToken"/> whose <c>TokenHash</c> already exists is
    /// rejected with a <see cref="DuplicateKeyException"/>, and the duplicate row is not persisted.
    /// </summary>
    [Fact]
    public async Task DuplicateTokenHash_SurfacesDuplicateKeyExceptionAndPersistsNothing()
    {
        await WithAuthSchemaAsync(async connectionString =>
        {
            const string sharedHash = "shared-refresh-token-hash";

            Guid userId;
            Guid firstTokenId;
            await using (var seed = CreateContext(connectionString))
            {
                var user = User.Create("Casey", "casey@example.com");
                userId = user.Id;
                await new EfUserRepository(seed).AddAsync(user, CancellationToken.None);

                var first = RefreshToken.StartFamily(user.Id, sharedHash, TokenExpiry);
                firstTokenId = first.Id;
                await new EfRefreshTokenStore(seed).AddAsync(first, CancellationToken.None);

                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // A second token in a brand-new family, colliding only on the hash.
            Guid secondTokenId;
            await using (var context = CreateContext(connectionString))
            {
                var second = RefreshToken.StartFamily(userId, sharedHash, TokenExpiry);
                secondTokenId = second.Id;
                await new EfRefreshTokenStore(context).AddAsync(second, CancellationToken.None);

                await Assert.ThrowsAsync<DuplicateKeyException>(
                    () => new UnitOfWork(context).SaveChangesAsync(CancellationToken.None));
            }

            await using var verify = CreateContext(connectionString);
            var stored = await verify.Set<RefreshToken>()
                .IgnoreQueryFilters()
                .Where(t => t.TokenHash == sharedHash)
                .Select(t => t.Id)
                .ToListAsync();

            Assert.Equal(new[] { firstTokenId }, stored);
            Assert.DoesNotContain(secondTokenId, stored);
        });
    }

    // Requirement 2.1 — registration creates User + Password AuthIdentity + PasswordCredential as a
    // single atomic operation; if any step fails, no User, AuthIdentity, or PasswordCredential is
    // persisted. The mid-operation failure is induced by a colliding (Provider, ProviderUserId).
    /// <summary>
    /// When a registration's atomic save fails partway (a colliding identity forces a unique-index
    /// violation), none of the new <see cref="User"/>, <see cref="AuthIdentity"/>, or
    /// <see cref="PasswordCredential"/> rows are persisted.
    /// </summary>
    [Fact]
    public async Task Registration_RollsBackAtomically_OnInducedMidOperationFailure()
    {
        await WithAuthSchemaAsync(async connectionString =>
        {
            // A pre-existing identity already owns the email the registration will try to claim.
            await using (var seed = CreateContext(connectionString))
            {
                var existing = User.Create("Existing", "taken@example.com");
                await new EfUserRepository(seed).AddAsync(existing, CancellationToken.None);
                await new EfAuthIdentityRepository(seed).AddAsync(
                    AuthIdentity.ForPassword(existing.Id, "taken@example.com", PasswordCredential.Create("hash-existing")),
                    CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // A registration exactly as RegisterWithPasswordHandler stages it: User + Password
            // identity + credential in one unit of work — but the normalised email is already taken,
            // so the identity insert violates the unique (Provider, ProviderUserId) index mid-save.
            Guid newUserId;
            await using (var context = CreateContext(connectionString))
            {
                var newUser = User.Create("Newcomer", "taken@example.com");
                newUserId = newUser.Id;
                await new EfUserRepository(context).AddAsync(newUser, CancellationToken.None);
                await new EfAuthIdentityRepository(context).AddAsync(
                    AuthIdentity.ForPassword(newUser.Id, "taken@example.com", PasswordCredential.Create("hash-new")),
                    CancellationToken.None);

                await Assert.ThrowsAsync<DuplicateKeyException>(
                    () => new UnitOfWork(context).SaveChangesAsync(CancellationToken.None));
            }

            // No partial persistence: the new user does not exist, and only the pre-existing
            // identity/credential remain.
            await using var verify = CreateContext(connectionString);

            var newUserExists = await verify.Set<User>()
                .IgnoreQueryFilters()
                .AnyAsync(u => u.Id == newUserId);
            Assert.False(newUserExists);

            var identityCount = await verify.Set<AuthIdentity>()
                .IgnoreQueryFilters()
                .CountAsync(i => i.Provider == AuthProvider.Password && i.ProviderUserId == "taken@example.com");
            Assert.Equal(1, identityCount);

            var credentialCount = await verify.Set<PasswordCredential>()
                .IgnoreQueryFilters()
                .CountAsync();
            Assert.Equal(1, credentialCount);
        });
    }

    // Requirement 14.7 — erasure anonymises PII, removes credentials, and revokes refresh tokens as a
    // single atomic operation; on failure the whole operation rolls back, leaving PII and credentials
    // in their pre-erasure state. The mid-operation failure is induced by a colliding identity insert.
    /// <summary>
    /// When an erasure's atomic save fails partway, every change rolls back: the user's PII is
    /// unchanged, its <see cref="PasswordCredential"/> is still present and not soft-deleted, and its
    /// <see cref="RefreshToken"/> is still <see cref="RefreshTokenStatus.Active"/>.
    /// </summary>
    [Fact]
    public async Task Erasure_RollsBackAtomically_OnInducedMidOperationFailure()
    {
        await WithAuthSchemaAsync(async connectionString =>
        {
            Guid userId;
            await using (var seed = CreateContext(connectionString))
            {
                var user = User.Create("Dana", "erase@example.com", emailVerified: true);
                userId = user.Id;
                await new EfUserRepository(seed).AddAsync(user, CancellationToken.None);
                await new EfAuthIdentityRepository(seed).AddAsync(
                    AuthIdentity.ForPassword(user.Id, "erase@example.com", PasswordCredential.Create("hash-erase")),
                    CancellationToken.None);
                await new EfRefreshTokenStore(seed).AddAsync(
                    RefreshToken.StartFamily(user.Id, "erase-refresh-hash", TokenExpiry),
                    CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // Erasure work — anonymise the user, remove the credential, revoke the refresh token —
            // bundled in one unit of work with an induced failure (a colliding identity insert).
            await using (var context = CreateContext(connectionString))
            {
                var user = await context.Set<User>()
                    .Include(u => u.Identities)
                        .ThenInclude(i => i.Credential)
                    .FirstAsync(u => u.Id == userId);
                user.Anonymise();

                var credential = user.Identities.Single().Credential!;
                context.Set<PasswordCredential>().Remove(credential);

                var token = await context.Set<RefreshToken>().FirstAsync(t => t.UserId == userId);
                token.Revoke();

                // Induce a mid-operation failure: a new identity colliding on the still-present key.
                await new EfAuthIdentityRepository(context).AddAsync(
                    AuthIdentity.ForPassword(userId, "erase@example.com", PasswordCredential.Create("hash-dup")),
                    CancellationToken.None);

                await Assert.ThrowsAsync<DuplicateKeyException>(
                    () => new UnitOfWork(context).SaveChangesAsync(CancellationToken.None));
            }

            // Everything rolled back to the pre-erasure state.
            await using var verify = CreateContext(connectionString);

            var storedUser = await verify.Set<User>().FirstAsync(u => u.Id == userId);
            Assert.Equal("erase@example.com", storedUser.Email);
            Assert.Equal("Dana", storedUser.DisplayName);
            Assert.True(storedUser.EmailVerified);

            var credentialCount = await verify.Set<PasswordCredential>()
                .IgnoreQueryFilters()
                .CountAsync(c => !c.IsDeleted);
            Assert.Equal(1, credentialCount);

            var storedToken = await verify.Set<RefreshToken>().FirstAsync(t => t.UserId == userId);
            Assert.Equal(RefreshTokenStatus.Active, storedToken.Status);
        });
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database, using
    /// deterministic fakes for the clock and actor so audit stamping is repeatable.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, creates the production model's
    /// schema (including every auth table, unique index, and foreign key) against it, runs the test
    /// body against a connection string targeting it, and drops it afterwards regardless of outcome.
    /// </summary>
    private async Task WithAuthSchemaAsync(Func<string, Task> body)
    {
        var databaseName = "auth_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString))
            {
                await schema.Database.EnsureCreatedAsync();
            }

            await body(connectionString);
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }
}
