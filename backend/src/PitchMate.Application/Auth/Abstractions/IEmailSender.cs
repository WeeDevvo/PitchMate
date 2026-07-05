namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Delivers transactional auth emails (verification and password-reset links). Implemented in
/// Infrastructure with profile-selected transports (console for local, a cloud provider otherwise); the
/// Application layer depends only on this abstraction (Requirements 11.1, 12.2).
/// </summary>
public interface IEmailSender
{
    /// <summary>
    /// Attempts to deliver <paramref name="message"/>, rejecting a malformed recipient before any send
    /// attempt and surfacing delivery success or failure as a <see cref="Result"/> rather than throwing
    /// (Requirements 11.4, 11.5).
    /// </summary>
    Task<Result> SendAsync(EmailMessage message, CancellationToken cancellationToken);
}
