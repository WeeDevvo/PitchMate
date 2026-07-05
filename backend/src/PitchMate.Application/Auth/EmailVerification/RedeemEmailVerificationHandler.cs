using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.EmailVerification;

/// <summary>
/// Redeems an email-verification token (Requirements 4.2–4.5, 4.9). A presented secret is
/// matched by its one-way hash against the single currently redeemable (unredeemed and
/// unexpired) token; on a match the owning user's email is marked verified and the token
/// is marked redeemed in one atomic commit.
/// <para>
/// Any token that is expired, already redeemed/superseded, or unknown is not redeemable
/// and is rejected with an invalid-token error, leaving the email verification state
/// unchanged. Because <see cref="User.MarkEmailVerified"/> is idempotent, redeeming a
/// still-valid token for an already-verified address succeeds without error (Requirement 4.9).
/// </para>
/// </summary>
public sealed class RedeemEmailVerificationHandler
{
    private readonly IEmailVerificationTokenRepository _tokens;
    private readonly IUserRepository _users;
    private readonly ISecretHasher _secretHasher;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>Creates the handler from its collaborating abstractions.</summary>
    public RedeemEmailVerificationHandler(
        IEmailVerificationTokenRepository tokens,
        IUserRepository users,
        ISecretHasher secretHasher,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(secretHasher);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _tokens = tokens;
        _users = users;
        _secretHasher = secretHasher;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Redeems the command's token. Returns success when a redeemable token is matched and
    /// its owner's email is marked verified; an invalid-token failure when the value is
    /// empty or matches no redeemable token (expired, already redeemed, or unknown), leaving
    /// state unchanged.
    /// </summary>
    /// <param name="command">The redemption request carrying the presented token.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(RedeemEmailVerificationCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (string.IsNullOrWhiteSpace(command.Token))
        {
            return InvalidToken();
        }

        // Match by one-way hash against the single currently redeemable token. A null result
        // covers the expired, already-redeemed, and unknown cases alike (Requirements 4.3–4.5).
        string tokenHash = _secretHasher.Hash(command.Token);
        EmailVerificationToken? token = await _tokens.FindRedeemableByHashAsync(tokenHash, cancellationToken);
        if (token is null)
        {
            return InvalidToken();
        }

        User? user = await _users.GetByIdAsync(token.UserId, cancellationToken);
        if (user is null)
        {
            return Result.Fail(new AuthError(
                AuthErrorCode.UserNotFound,
                "The token's owning user no longer exists."));
        }

        // MarkEmailVerified is idempotent, so an already-verified address stays verified and
        // the redemption still reports success (Requirement 4.9).
        user.MarkEmailVerified();
        token.Redeem(_clock.GetUtcNow());

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static Result InvalidToken() =>
        Result.Fail(new AuthError(
            AuthErrorCode.TokenInvalid,
            "The verification token is invalid, expired, or has already been redeemed."));
}
