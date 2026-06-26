using Microsoft.Extensions.Options;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.EmailVerification;

/// <summary>
/// Initiates email verification for a user (Requirements 4.1, 4.6, 4.8): it supersedes any
/// prior unredeemed verification token for the user so at most one is ever redeemable,
/// issues a fresh single-use token whose expiry is the Clock instant plus the configured
/// lifetime, persists only the token's one-way hash, and sends the verification message
/// through the <see cref="IEmailSender"/>.
/// <para>
/// Delivery is attempted before the work is committed: if the email cannot be sent the
/// handler returns a delivery failure and commits nothing, so the user's verification
/// state is left unchanged and verification can be initiated again (Requirement 4.6).
/// </para>
/// </summary>
public sealed class RequestEmailVerificationHandler
{
    private const string EmailSubject = "Verify your PitchMate email address";

    private readonly IUserRepository _users;
    private readonly IEmailVerificationTokenRepository _tokens;
    private readonly ISecretTokenGenerator _tokenGenerator;
    private readonly ISecretHasher _secretHasher;
    private readonly IEmailSender _emailSender;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;
    private readonly EmailVerificationOptions _options;

    /// <summary>Creates the handler from its collaborating abstractions.</summary>
    public RequestEmailVerificationHandler(
        IUserRepository users,
        IEmailVerificationTokenRepository tokens,
        ISecretTokenGenerator tokenGenerator,
        ISecretHasher secretHasher,
        IEmailSender emailSender,
        IUnitOfWork unitOfWork,
        TimeProvider clock,
        IOptions<EmailVerificationOptions> options)
    {
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(tokens);
        ArgumentNullException.ThrowIfNull(tokenGenerator);
        ArgumentNullException.ThrowIfNull(secretHasher);
        ArgumentNullException.ThrowIfNull(emailSender);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(options);

        _users = users;
        _tokens = tokens;
        _tokenGenerator = tokenGenerator;
        _secretHasher = secretHasher;
        _emailSender = emailSender;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _options = options.Value;
    }

    /// <summary>
    /// Issues and sends a verification token for the command's user, superseding any prior
    /// unredeemed token. Returns success once the message is accepted and the work is
    /// committed, a delivery failure when the email cannot be sent (committing nothing), or
    /// a not-found failure when the user does not exist.
    /// </summary>
    /// <param name="command">The request identifying the user to verify.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(RequestEmailVerificationCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        User? user = await _users.GetByIdAsync(command.UserId, cancellationToken);
        if (user is null)
        {
            return Result.Fail(new AuthError(
                AuthErrorCode.UserNotFound,
                "No user exists for the supplied identifier."));
        }

        // Supersede any prior unredeemed token so at most one is redeemable at a time (Requirement 4.8).
        IReadOnlyList<EmailVerificationToken> priorTokens =
            await _tokens.ListUnredeemedForUserAsync(user.Id, cancellationToken);
        foreach (EmailVerificationToken prior in priorTokens)
        {
            prior.Invalidate();
        }

        // Issue a fresh single-use token; persist only its one-way hash (Requirements 4.1, 4.7).
        string secret = _tokenGenerator.Generate();
        string tokenHash = _secretHasher.Hash(secret);
        DateTimeOffset expiresAt = _clock.GetUtcNow() + _options.TokenLifetime;

        EmailVerificationToken token = EmailVerificationToken.Issue(user.Id, tokenHash, expiresAt);
        await _tokens.AddAsync(token, cancellationToken);

        // Attempt delivery before committing. On failure, commit nothing so the verification
        // state is unchanged and a new token can be requested (Requirement 4.6).
        var message = new EmailMessage(user.Email, EmailSubject, BuildBody(secret));
        Result delivery = await _emailSender.SendAsync(message, cancellationToken);
        if (!delivery.IsSuccess)
        {
            return delivery.Error is { } error
                ? Result.Fail(error)
                : Result.Fail(new AuthError(
                    AuthErrorCode.DeliveryFailed,
                    "The verification email could not be delivered."));
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result.Ok();
    }

    private static string BuildBody(string secret) =>
        $"Confirm your PitchMate email address by completing verification with the following code: {secret}";
}
