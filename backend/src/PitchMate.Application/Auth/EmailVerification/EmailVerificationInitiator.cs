using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.EmailVerification;

/// <summary>
/// The production <see cref="IEmailVerificationInitiator"/>: a thin adapter that lets the
/// registration flow <em>initiate</em> email verification (Requirement 2.6) without owning
/// the token-issuance and delivery logic, which belongs to
/// <see cref="RequestEmailVerificationHandler"/> (Requirements 4.1, 4.6, 4.8).
/// <para>
/// It simply translates the <see cref="User"/> the caller holds into a
/// <see cref="RequestEmailVerificationCommand"/> keyed on the user's id and delegates to the
/// verification use case, surfacing its <see cref="Result"/> (including a delivery failure)
/// unchanged.
/// </para>
/// </summary>
public sealed class EmailVerificationInitiator : IEmailVerificationInitiator
{
    private readonly RequestEmailVerificationHandler _handler;

    /// <summary>Creates the initiator delegating to the verification use case.</summary>
    public EmailVerificationInitiator(RequestEmailVerificationHandler handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _handler = handler;
    }

    /// <inheritdoc />
    public Task<Result> InitiateAsync(User user, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(user);
        return _handler.HandleAsync(new RequestEmailVerificationCommand(user.Id), ct);
    }
}
