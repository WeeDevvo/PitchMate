using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

/// <summary>
/// Property 29: Password-reset requests are indistinguishable for existing and non-existing
/// accounts.
/// <para>
/// For any valid email, requesting a password reset returns an identical successful
/// <see cref="Result"/> whether or not a Password identity exists for that email, so the
/// response reveals nothing about account existence. When no account exists, no email is
/// sent (the only difference is an unobservable side effect). Exercised over in-memory fakes
/// as a pure Application unit test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class IndistinguishableResetRequestPropertyTests
{
    // Feature: auth-and-identity, Property 29: Password-reset requests are indistinguishable
    // for existing and non-existing accounts. Validates: Requirements 5.2
    [Property(MaxTest = 100)]
    [Trait("Property", "29")]
    public Property ResetRequest_IsIdentical_ForExistingAndNonExistingAccounts() =>
        Prop.ForAll(Arb.From(PasswordResetGenerators.ValidEmail()), rawEmail =>
        {
            string normalisedEmail = EmailAddress.Create(rawEmail).Value!.Value;

            // Existing account: a Password identity keyed on the normalised email.
            var credential = PasswordCredential.Create("pwhash::existing-account");
            var identity = AuthIdentity.ForPassword(Guid.CreateVersion7(), normalisedEmail, credential);
            var (existingHandler, existingEmail) = BuildRequestHandler(identity);

            // Non-existing account: nothing seeded.
            var (missingHandler, missingEmail) = BuildRequestHandler(identity: null);

            var existingResult = existingHandler
                .HandleAsync(new RequestPasswordResetCommand(rawEmail), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            var missingResult = missingHandler
                .HandleAsync(new RequestPasswordResetCommand(rawEmail), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // The two results are byte-for-byte identical (both Ok, no distinguishing field).
            bool resultsIdentical =
                existingResult == missingResult
                && existingResult.IsSuccess
                && existingResult.Error is null;

            // No email is sent for the non-existent account; one is sent for the real one.
            bool noEmailWhenMissing = missingEmail.Sent.Count == 0;
            bool emailWhenExisting = existingEmail.Sent.Count == 1;

            return resultsIdentical && noEmailWhenMissing && emailWhenExisting;
        });

    private static (RequestPasswordResetHandler Handler, PasswordResetEmailSenderFake Email) BuildRequestHandler(
        AuthIdentity? identity)
    {
        var clock = new PasswordResetFakeClock();
        var authIdentities = new PasswordResetAuthIdentityRepositoryFake();
        if (identity is not null)
        {
            authIdentities.Seed(identity);
        }

        var resetTokens = new PasswordResetTokenRepositoryFake(clock);
        var email = new PasswordResetEmailSenderFake();

        var handler = new RequestPasswordResetHandler(
            authIdentities,
            resetTokens,
            new PasswordResetSecretTokenGeneratorFake(),
            new PasswordResetSecretHasherFake(),
            email,
            new PasswordResetUnitOfWorkFake(),
            clock,
            new PasswordResetOptions());

        return (handler, email);
    }
}
