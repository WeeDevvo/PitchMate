using System.Reflection;
using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Infrastructure.Auth.Email;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Integration tests for the local/development <see cref="ConsoleEmailSender"/> (auth-and-identity task
/// 7.6). They verify the console transport's Requirement 11.2 contract: in the local profile the sender
/// "delivers" a message by writing its recipient, subject, and body to the injected application logger,
/// and it opens <em>no</em> connection to any external email service.
///
/// <para>
/// The sender's only side effect is the log write, so the test injects a capturing
/// <see cref="ILogger{T}"/>, sends a real <see cref="EmailMessage"/>, and asserts the recipient, subject,
/// and body all reach the log — both in the rendered message text and as individual structured values.
/// The "no external connection" half of the requirement is asserted structurally: the type depends on
/// nothing but a logger (no HTTP/SMTP/cloud-email client), so there is nothing through which it could
/// reach the network. Delivery also completes synchronously and successfully, as a network-free transport
/// must.
/// </para>
///
/// **Validates: Requirement 11.2**
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class ConsoleEmailSenderIntegrationTests
{
    // A recipient that survives Domain EmailAddress validation/normalisation unchanged (already lower-case,
    // no surrounding whitespace) so the value written to the log equals what we assert on.
    private const string Recipient = "player@example.com";
    private const string Subject = "Verify your PitchMate email";
    private const string Body = "Tap the link to confirm your address: https://pitch-mate.co.uk/verify?token=abc123";

    [Fact]
    public async Task SendAsync_WritesRecipientSubjectAndBodyToTheLog()
    {
        var logger = new CapturingLogger<ConsoleEmailSender>();
        var sender = new ConsoleEmailSender(logger);

        var result = await sender.SendAsync(new EmailMessage(Recipient, Subject, Body), CancellationToken.None);

        // The console transport always "delivers" successfully.
        Assert.True(result.IsSuccess);

        // Exactly one log entry is emitted for the send.
        var entry = Assert.Single(logger.Entries);

        // The rendered message carries every part of the email so a developer reading the console sees it.
        Assert.Contains(Recipient, entry.RenderedMessage, StringComparison.Ordinal);
        Assert.Contains(Subject, entry.RenderedMessage, StringComparison.Ordinal);
        Assert.Contains(Body, entry.RenderedMessage, StringComparison.Ordinal);

        // ...and each is present as an individual structured value, keyed by name.
        Assert.Equal(Recipient, entry.StateValue("Recipient"));
        Assert.Equal(Subject, entry.StateValue("Subject"));
        Assert.Equal(Body, entry.StateValue("Body"));
    }

    [Fact]
    public async Task SendAsync_NormalisesRecipientBeforeWritingItToTheLog()
    {
        var logger = new CapturingLogger<ConsoleEmailSender>();
        var sender = new ConsoleEmailSender(logger);

        // A recipient differing only by case and surrounding whitespace is normalised by the shared
        // EmailSenderBase before the transport runs, so the log records the canonical address.
        var result = await sender.SendAsync(
            new EmailMessage("  Player@Example.COM  ", Subject, Body), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var entry = Assert.Single(logger.Entries);
        Assert.Equal(Recipient, entry.StateValue("Recipient"));
    }

    [Fact]
    public void ConsoleEmailSender_OpensNoExternalConnection_HasNoNetworkClientDependency()
    {
        // The only way the console sender could reach an external email service is by holding a client
        // that talks to one. It depends solely on a logger, so there is no such path: assert every
        // constructor parameter and every instance field is a logger (or logger factory), never an
        // HTTP/SMTP/cloud-email client.
        var type = typeof(ConsoleEmailSender);

        foreach (var parameter in type.GetConstructors().SelectMany(c => c.GetParameters()))
        {
            Assert.True(
                IsLoggerType(parameter.ParameterType),
                $"ConsoleEmailSender constructor depends on '{parameter.ParameterType.FullName}', which could open an external connection.");
        }

        foreach (var field in type.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public))
        {
            Assert.True(
                IsLoggerType(field.FieldType),
                $"ConsoleEmailSender holds field '{field.Name}' of type '{field.FieldType.FullName}', which could open an external connection.");
        }
    }

    private static bool IsLoggerType(Type type)
    {
        if (type == typeof(ILoggerFactory))
        {
            return true;
        }

        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(ILogger<>))
        {
            return true;
        }

        return type == typeof(ILogger);
    }

    /// <summary>
    /// An <see cref="ILogger{T}"/> that records every entry in memory (rendered text plus the structured
    /// state values) so a test can assert exactly what a transport wrote — the console sender's only
    /// observable side effect.
    /// </summary>
    private sealed class CapturingLogger<T> : ILogger<T>
    {
        private readonly List<LogEntry> _entries = [];

        public IReadOnlyList<LogEntry> Entries => _entries;

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var values = state as IReadOnlyList<KeyValuePair<string, object?>>
                ?? [];

            _entries.Add(new LogEntry(logLevel, formatter(state, exception), values));
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();

            public void Dispose()
            {
            }
        }
    }

    private sealed record LogEntry(
        LogLevel Level,
        string RenderedMessage,
        IReadOnlyList<KeyValuePair<string, object?>> State)
    {
        public object? StateValue(string key) =>
            State.FirstOrDefault(kvp => string.Equals(kvp.Key, key, StringComparison.Ordinal)).Value;
    }
}
