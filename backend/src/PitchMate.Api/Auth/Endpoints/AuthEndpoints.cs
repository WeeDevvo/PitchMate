using System.Security.Claims;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.EmailVerification;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Application.Auth.UseCases;

namespace PitchMate.Api.Auth.Endpoints;

/// <summary>
/// Maps the minimal-API auth endpoints (Requirement 13). Every endpoint is a thin adapter: it binds
/// the request, delegates the whole authentication decision to an Application use-case handler, and
/// translates the returned <see cref="Result"/>/<see cref="Result{T}"/> to an HTTP result through the
/// single <see cref="AuthErrorResults"/> seam — so the Api holds no authentication logic itself
/// (Requirements 12.4, 12.5).
/// <para>
/// The public endpoints (register, sign-in, Google sign-in, refresh, password-reset request, and
/// email-verification redeem) are reachable without an access token (Requirement 13.6). The protected
/// endpoints (sign-out, account linking, add-password, unlink, email-verification resend, erasure, and
/// export) require an authenticated caller and resolve the acting <c>User</c> identity from the access
/// token's subject claim rather than any client-supplied body value (Requirements 13.1, 13.2). The
/// JWT bearer scheme, the uniform unauthenticated response, and the OpenAPI security description are
/// configured separately with the authentication middleware.
/// </para>
/// </summary>
public static class AuthEndpoints
{
    /// <summary>
    /// Maps every auth endpoint under the <c>/auth</c> route group onto <paramref name="endpoints"/>.
    /// </summary>
    /// <param name="endpoints">The route builder to map the endpoints onto.</param>
    /// <returns>The <c>/auth</c> route group for further configuration.</returns>
    public static RouteGroupBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        RouteGroupBuilder group = endpoints.MapGroup("/auth").WithTags("Auth");

        MapPublicEndpoints(group);
        MapProtectedEndpoints(group);

        return group;
    }

    /// <summary>
    /// Maps the endpoints reachable without a prior access token (Requirement 13.6).
    /// </summary>
    private static void MapPublicEndpoints(RouteGroupBuilder group)
    {
        // Register a new email + password account (Requirement 2). The command is bound directly from
        // the body; the handler validates and normalises it.
        group.MapPost("/register", static async (
            RegisterWithPasswordCommand command,
            RegisterWithPasswordHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("Register");

        // Sign in with email + password (Requirement 6).
        group.MapPost("/sign-in", static async (
            SignInWithPasswordCommand command,
            SignInWithPasswordHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("SignIn");

        // Sign in with Google (Requirement 7).
        group.MapPost("/sign-in/google", static async (
            SignInWithGoogleCommand command,
            SignInWithGoogleHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("SignInWithGoogle");

        // Exchange a rotating refresh token for a fresh session (Requirement 9.2).
        group.MapPost("/refresh", static async (
            RefreshSessionCommand command,
            RefreshSessionHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("RefreshSession");

        // Request a password reset. The response is deliberately uniform regardless of account
        // existence (Requirement 5.2), so it always reports success.
        group.MapPost("/password-reset/request", static async (
            RequestPasswordResetCommand command,
            RequestPasswordResetHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("RequestPasswordReset");

        // Redeem a password-reset token and set a new password (Requirements 5.3–5.7).
        group.MapPost("/password-reset/redeem", static async (
            RedeemPasswordResetCommand command,
            RedeemPasswordResetHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("RedeemPasswordReset");

        // Redeem an email-verification token (Requirements 4.2–4.5). Reachable without a token so a
        // user can verify from the emailed link before signing in.
        group.MapPost("/email/verification/redeem", static async (
            RedeemEmailVerificationCommand command,
            RedeemEmailVerificationHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .AllowAnonymous()
            .WithName("RedeemEmailVerification");
    }

    /// <summary>
    /// Maps the endpoints that require an authenticated caller. Each resolves the acting user from the
    /// access token's subject claim (Requirement 13.1) and never trusts a body-supplied identity.
    /// </summary>
    private static void MapProtectedEndpoints(RouteGroupBuilder group)
    {
        // Sign out, revoking the presented refresh token's whole family (Requirement 9.4).
        group.MapPost("/sign-out", static async (
            SignOutCommand command,
            SignOutHandler handler,
            CancellationToken ct) => ToHttpResult(await handler.HandleAsync(command, ct)))
            .RequireAuthorization()
            .WithName("SignOut");

        // Link an additional external sign-in method to the authenticated account (Requirement 10.1).
        group.MapPost("/identities/external", static async (
            LinkExternalProviderRequest request,
            ClaimsPrincipal principal,
            LinkExternalProviderHandler handler,
            CancellationToken ct) =>
        {
            var command = new LinkExternalProviderCommand(
                CallerIdentity.ResolveUserId(principal), request.Provider, request.Assertion);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("LinkExternalProvider");

        // Add a Password sign-in method to an authenticated account that lacks one (Requirement 10.5).
        group.MapPost("/identities/password", static async (
            AddPasswordRequest request,
            ClaimsPrincipal principal,
            AddPasswordCredentialHandler handler,
            CancellationToken ct) =>
        {
            var command = new AddPasswordCredentialCommand(
                CallerIdentity.ResolveUserId(principal), request.Password);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("AddPasswordCredential");

        // Unlink one of the account's sign-in methods, never the last (Requirements 10.6, 10.7).
        group.MapDelete("/identities/{identityId:guid}", static async (
            Guid identityId,
            ClaimsPrincipal principal,
            UnlinkAuthIdentityHandler handler,
            CancellationToken ct) =>
        {
            var command = new UnlinkAuthIdentityCommand(
                CallerIdentity.ResolveUserId(principal), identityId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("UnlinkAuthIdentity");

        // Resend the caller's own email-verification message (Requirements 4.1, 4.6).
        group.MapPost("/email/verification/request", static async (
            ClaimsPrincipal principal,
            RequestEmailVerificationHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new RequestEmailVerificationCommand(userId), ct));
        })
            .RequireAuthorization()
            .WithName("RequestEmailVerification");

        // Erase (anonymise) the caller's own account (Requirement 14).
        group.MapPost("/erasure", static async (
            ClaimsPrincipal principal,
            EraseUserHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new EraseUserCommand(userId), ct));
        })
            .RequireAuthorization()
            .WithName("EraseUser");

        // Export the caller's own auth data (DSAR) excluding all secrets (Requirement 14.4).
        group.MapGet("/export", static async (
            ClaimsPrincipal principal,
            ExportUserDataHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ExportUserDataCommand(userId), ct));
        })
            .RequireAuthorization()
            .WithName("ExportUserData");
    }

    /// <summary>
    /// Translates a valueless use-case <see cref="Result"/> to <c>204 No Content</c> on success or a
    /// mapped problem result on failure.
    /// </summary>
    private static IResult ToHttpResult(Result result) =>
        result.IsSuccess ? Results.NoContent() : AuthErrorResults.ToHttpResult(result.Error!);

    /// <summary>
    /// Translates a value-bearing use-case <see cref="Result{T}"/> to <c>200 OK</c> carrying the value
    /// on success or a mapped problem result on failure.
    /// </summary>
    private static IResult ToHttpResult<T>(Result<T> result) =>
        result.IsSuccess ? Results.Ok(result.Value) : AuthErrorResults.ToHttpResult(result.Error!);

    /// <summary>
    /// The uniform unauthenticated result for a protected endpoint whose caller identity could not be
    /// resolved from the access token (Requirements 13.1, 13.5).
    /// </summary>
    private static IResult Unauthenticated() =>
        AuthErrorResults.ToHttpResult(new AuthError(
            AuthErrorCode.Unauthenticated,
            "Authentication is required."));
}
