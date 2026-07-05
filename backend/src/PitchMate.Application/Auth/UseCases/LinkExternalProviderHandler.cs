using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Links an additional external (non-Password) sign-in method to an already-authenticated
/// account (Requirement 10). Linking is a deliberate, authenticated action and is never an
/// automatic merge on a shared email (Requirement 10.4): the caller must present a valid
/// session and the second provider's assertion must validate.
/// <list type="bullet">
///   <item>A request without an authenticated session links nothing and fails with
///   <see cref="AuthErrorCode.Unauthenticated"/> (Requirement 10.2).</item>
///   <item>An assertion the verifier rejects attaches no identity, leaves the requesting
///   user unchanged, and fails with <see cref="AuthErrorCode.AuthenticationFailed"/>
///   (Requirement 10.8).</item>
///   <item>If the validated <c>(Provider, ProviderUserId)</c> is already attached to any
///   user, the link is rejected with <see cref="AuthErrorCode.IdentityAlreadyLinked"/>,
///   leaving both the requesting user and the existing identity's owner unchanged
///   (Requirement 10.3).</item>
///   <item>Otherwise a new external <see cref="AuthIdentity"/> for the validated
///   <c>(Provider, ProviderUserId)</c> is attached to the requesting user
///   (Requirement 10.1).</item>
/// </list>
/// Resolution of an existing attachment is done <strong>solely</strong> on the pair
/// <c>(Provider, ProviderUserId)</c>, never on email (Requirement 10.4).
/// </summary>
public sealed class LinkExternalProviderHandler
{
    private readonly IExternalProviderVerifier _verifier;
    private readonly IUserRepository _users;
    private readonly IAuthIdentityRepository _identities;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the external-provider verifier, repositories, and unit of
    /// work it commits through.
    /// </summary>
    public LinkExternalProviderHandler(
        IExternalProviderVerifier verifier,
        IUserRepository users,
        IAuthIdentityRepository identities,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(verifier);
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(identities);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _verifier = verifier;
        _users = users;
        _identities = identities;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="LinkExternalProviderCommand"/>, returning the linked identity's
    /// details on success or a typed <see cref="AuthError"/> on a missing session, an
    /// invalid assertion, or an already-attached identity.
    /// </summary>
    /// <param name="command">The linking request carrying the authenticated user and assertion.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    public async Task<Result<LinkExternalProviderResult>> HandleAsync(
        LinkExternalProviderCommand command,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Account_Linking requires a valid authenticated session; an unauthenticated request
        // can never link an identity (Requirement 10.2).
        if (command.UserId is not { } userId || userId == Guid.Empty)
        {
            return Unauthenticated();
        }

        // Linking is only for external providers; a Password method is added via
        // AddPasswordCredentialHandler, not here.
        if (command.Provider == AuthProvider.Password)
        {
            return Fail(
                AuthErrorCode.ValidationFailed,
                "A Password sign-in method cannot be linked through external-provider linking.");
        }

        // Validate the second provider's assertion. A rejected assertion attaches nothing and
        // leaves the requesting user unchanged (Requirement 10.8).
        Result<ExternalIdentity> verification =
            await _verifier.ValidateAsync(command.Provider, command.Assertion ?? string.Empty, ct);
        if (!verification.IsSuccess)
        {
            return AssertionInvalid();
        }

        ExternalIdentity external = verification.Value!;

        // Defence in depth: the validated assertion must match the requested provider and carry
        // a subject before it can resolve or attach an identity.
        if (external.Provider != command.Provider || string.IsNullOrWhiteSpace(external.ProviderUserId))
        {
            return AssertionInvalid();
        }

        // The requesting principal must exist for the session to be valid.
        User? user = await _users.GetByIdAsync(userId, ct);
        if (user is null)
        {
            return Unauthenticated();
        }

        // Reject when the validated (Provider, ProviderUserId) is already attached to any user,
        // matched solely on the provider key — never on email (Requirements 10.3, 10.4). Both the
        // requesting user and the existing owner are left unchanged.
        AuthIdentity? existing =
            await _identities.FindByProviderKeyAsync(external.Provider, external.ProviderUserId, ct);
        if (existing is not null)
        {
            return AlreadyLinked();
        }

        // Attach the new external identity to the requesting user (Requirement 10.1).
        AuthIdentity identity =
            AuthIdentity.ForExternal(user.Id, external.Provider, external.ProviderUserId);

        await _identities.AddAsync(identity, ct);

        try
        {
            await _unitOfWork.SaveChangesAsync(ct);
        }
        catch (DuplicateKeyException)
        {
            // A concurrent link of the same (Provider, ProviderUserId) won the race on the unique
            // index. Nothing from this operation was persisted (Requirement 10.3).
            return AlreadyLinked();
        }

        return Result<LinkExternalProviderResult>.Ok(
            new LinkExternalProviderResult(user.Id, identity.Id, identity.Provider));
    }

    private static Result<LinkExternalProviderResult> Unauthenticated() =>
        Fail(AuthErrorCode.Unauthenticated, "Account linking requires an authenticated session.");

    private static Result<LinkExternalProviderResult> AssertionInvalid() =>
        Fail(AuthErrorCode.AuthenticationFailed, "The provider assertion could not be validated.");

    private static Result<LinkExternalProviderResult> AlreadyLinked() =>
        Fail(AuthErrorCode.IdentityAlreadyLinked, "The identity is already linked to an account.");

    private static Result<LinkExternalProviderResult> Fail(AuthErrorCode code, string message) =>
        Result<LinkExternalProviderResult>.Fail(new AuthError(code, message));
}
