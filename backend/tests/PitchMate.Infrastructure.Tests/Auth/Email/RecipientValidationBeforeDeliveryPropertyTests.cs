using System.Net.Http;
using System.Net.Http.Headers;
using Azure;
using Azure.Communication.Email;
using FsCheck;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Auth.Email;
using SendGrid;
using SendGrid.Helpers.Mail;
using AppEmailMessage = PitchMate.Application.Auth.Abstractions.EmailMessage;
using EmailAddress = PitchMate.Domain.Auth.EmailAddress;
using SendGridResponse = SendGrid.Response;

namespace PitchMate.Infrastructure.Tests.Auth.Email;

/// <summary>
/// Property-based test for auth-and-identity design <b>Property 33: Malformed email recipients are
/// rejected before delivery</b>. For any email message whose recipient address is missing or malformed,
/// every concrete <see cref="IEmailSender"/> implementation returns a validation-failure
/// <see cref="Result"/> (<see cref="AuthErrorCode.InvalidEmail"/>) <em>before</em> it opens any external
/// connection or makes any send attempt. The transports are recording fakes that count invocations and
/// throw if ever reached, so the property proves the send path is never entered for a bad recipient.
///
/// The concrete senders share the recipient-validation gate in
/// <see cref="PitchMate.Infrastructure.Auth.Email.EmailSenderBase"/>, which reuses the canonical Domain
/// <see cref="EmailAddress"/> validation. The generator constructs strings that are guaranteed malformed
/// by construction (null, blank, no '@', misplaced/duplicated '@', dot-less or dot-terminated domain,
/// embedded whitespace, over-length) and the body asserts the precondition that
/// <see cref="EmailAddress.Create"/> rejects each one before asserting sender behaviour.
///
/// **Validates: Requirements 11.4**
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class RecipientValidationBeforeDeliveryPropertyTests
{
    // Property 33: a malformed recipient is rejected by the ConsoleEmailSender with an InvalidEmail
    // failure and nothing is written to the log (its "transport") — no external connection is opened.
    // **Validates: Requirements 11.4**
    [Property(MaxTest = 100)]
    [Trait("Property", "33")]
    public Property ConsoleSenderRejectsMalformedRecipientBeforeLogging()
    {
        return Prop.ForAll(Arb.From(MalformedRecipientGen()), recipient =>
        {
            var logger = new CountingLogger<ConsoleEmailSender>();
            var sender = new ConsoleEmailSender(logger);

            return RejectsBeforeDelivery(sender, recipient, () => logger.LogCount);
        });
    }

    // Property 33: a malformed recipient is rejected by the SendGridEmailSender with an InvalidEmail
    // failure and the SendGrid client is never invoked — no external connection is opened.
    // **Validates: Requirements 11.4**
    [Property(MaxTest = 100)]
    [Trait("Property", "33")]
    public Property SendGridSenderRejectsMalformedRecipientBeforeSending()
    {
        return Prop.ForAll(Arb.From(MalformedRecipientGen()), recipient =>
        {
            var client = new CountingSendGridClient();
            var sender = new SendGridEmailSender(client, DefaultOptions());

            return RejectsBeforeDelivery(sender, recipient, () => client.SendAttempts);
        });
    }

    // Property 33: a malformed recipient is rejected by the AzureCommunicationEmailSender with an
    // InvalidEmail failure and the Azure EmailClient is never invoked — no external connection is opened.
    // **Validates: Requirements 11.4**
    [Property(MaxTest = 100)]
    [Trait("Property", "33")]
    public Property AzureSenderRejectsMalformedRecipientBeforeSending()
    {
        return Prop.ForAll(Arb.From(MalformedRecipientGen()), recipient =>
        {
            var client = new CountingEmailClient();
            var sender = new AzureCommunicationEmailSender(client, DefaultOptions());

            return RejectsBeforeDelivery(sender, recipient, () => client.SendAttempts);
        });
    }

    /// <summary>
    /// Shared assertion: given a genuinely malformed <paramref name="recipient"/>, the
    /// <paramref name="sender"/> returns a failed <see cref="Result"/> carrying
    /// <see cref="AuthErrorCode.InvalidEmail"/> and its transport (measured by
    /// <paramref name="sendAttempts"/>) was never touched. If the generated value happens to be a valid
    /// address (it never should be, by construction) the case is skipped so the property stays meaningful.
    /// </summary>
    private static bool RejectsBeforeDelivery(IEmailSender sender, string? recipient, Func<int> sendAttempts)
    {
        // Precondition: the recipient really is rejected by the canonical Domain validation. This keeps
        // the property honest — we only assert the "malformed" behaviour for genuinely malformed input.
        if (EmailAddress.Create(recipient).IsSuccess)
        {
            return true;
        }

        var message = new AppEmailMessage(
            recipient!,
            "Verify your PitchMate email",
            "https://pitch-mate.co.uk/verify?token=example");

        var result = sender.SendAsync(message, CancellationToken.None).GetAwaiter().GetResult();

        var rejected = !result.IsSuccess && result.Error is { Code: AuthErrorCode.InvalidEmail };
        var noSendAttempt = sendAttempts() == 0;

        return rejected && noSendAttempt;
    }

    private static IOptions<EmailOptions> DefaultOptions() =>
        Options.Create(new EmailOptions
        {
            FromAddress = "no-reply@pitch-mate.co.uk",
            MaxTransientRetries = 3,
        });

    // --- Generators -------------------------------------------------------------------------------

    /// <summary>
    /// Generates recipient strings that are guaranteed to fail <see cref="EmailAddress.Create"/>, spanning
    /// every malformed category the validation rejects. Normalisation (trim + lower-case) cannot rescue any
    /// of these, so each remains malformed after normalisation.
    /// </summary>
    private static Gen<string?> MalformedRecipientGen()
    {
        // Token of lower-case letters/digits: contains no '@', no '.', no whitespace.
        Gen<string> tokenGen = Gen.NonEmptyListOf(
                Gen.Elements("abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()))
            .Select(chars => new string([.. chars]));

        Gen<string?> nullRecipient = Gen.Constant((string?)null);
        Gen<string?> blank = Gen.Elements<string?>("", "   ", "\t", " \r\n ");
        Gen<string?> noAtSign = tokenGen.Select(t => (string?)t);
        Gen<string?> leadingAt = tokenGen.Select(domain => (string?)("@" + domain + ".com"));
        Gen<string?> trailingAt = tokenGen.Select(local => (string?)(local + "@"));
        Gen<string?> doubleAt =
            from local in tokenGen
            from mid in tokenGen
            from domain in tokenGen
            select (string?)(local + "@" + mid + "@" + domain + ".com");
        Gen<string?> domainWithoutDot =
            from local in tokenGen
            from domain in tokenGen
            select (string?)(local + "@" + domain);
        Gen<string?> domainDotTerminated =
            from local in tokenGen
            from domain in tokenGen
            select (string?)(local + "@" + domain + ".");
        Gen<string?> embeddedWhitespace =
            from local in tokenGen
            from domain in tokenGen
            select (string?)(local + " x@" + domain + ".com");
        Gen<string?> overLength =
            from domain in tokenGen
            select (string?)(new string('a', 250) + "@" + domain + ".com");

        return Gen.OneOf(
            nullRecipient,
            blank,
            noAtSign,
            leadingAt,
            trailingAt,
            doubleAt,
            domainWithoutDot,
            domainDotTerminated,
            embeddedWhitespace,
            overLength);
    }

    // --- Recording transports ---------------------------------------------------------------------

    /// <summary>
    /// An <see cref="ILogger{T}"/> that counts log writes. The console sender's only "transport" is the
    /// logger, so a zero count proves no delivery was attempted for a malformed recipient.
    /// </summary>
    private sealed class CountingLogger<T> : ILogger<T>
    {
        private int _logCount;

        public int LogCount => Volatile.Read(ref _logCount);

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) => Interlocked.Increment(ref _logCount);
    }

    /// <summary>
    /// A fake <see cref="ISendGridClient"/> that records send attempts and throws if ever asked to send —
    /// so any accidental delivery attempt for a malformed recipient fails the property loudly. The other
    /// interface members are never exercised on the validation-rejection path.
    /// </summary>
    private sealed class CountingSendGridClient : ISendGridClient
    {
        private int _sendAttempts;

        public int SendAttempts => Volatile.Read(ref _sendAttempts);

        public string UrlPath { get; set; } = string.Empty;

        public string Version { get; set; } = string.Empty;

        public string MediaType { get; set; } = string.Empty;

        public Task<SendGridResponse> SendEmailAsync(SendGridMessage msg, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _sendAttempts);
            throw new InvalidOperationException(
                "SendGrid transport must not be invoked for a malformed recipient.");
        }

        public AuthenticationHeaderValue AddAuthorization(KeyValuePair<string, string> header) =>
            throw new NotSupportedException();

        public Task<SendGridResponse> MakeRequest(HttpRequestMessage request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<SendGridResponse> RequestAsync(
            BaseClient.Method method,
            string? requestBody = null,
            string? queryParams = null,
            string? urlPath = null,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// A fake Azure <see cref="EmailClient"/> that records send attempts and throws if ever asked to send —
    /// so any accidental delivery attempt for a malformed recipient fails the property loudly.
    /// </summary>
    private sealed class CountingEmailClient : EmailClient
    {
        private int _sendAttempts;

        public int SendAttempts => Volatile.Read(ref _sendAttempts);

        public override Task<EmailSendOperation> SendAsync(
            WaitUntil wait,
            string senderAddress,
            string recipientAddress,
            string subject,
            string? htmlContent = null,
            string? plainTextContent = null,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _sendAttempts);
            throw new InvalidOperationException(
                "Azure Communication Services transport must not be invoked for a malformed recipient.");
        }
    }
}
