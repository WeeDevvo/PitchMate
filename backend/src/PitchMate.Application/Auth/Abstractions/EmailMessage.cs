namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// A transactional email to deliver: its <paramref name="Recipient"/> address, <paramref name="Subject"/>,
/// and <paramref name="Body"/>. Transport-agnostic so any <see cref="IEmailSender"/> implementation can
/// render it.
/// </summary>
/// <param name="Recipient">The destination email address.</param>
/// <param name="Subject">The message subject line.</param>
/// <param name="Body">The message body.</param>
public sealed record EmailMessage(string Recipient, string Subject, string Body);
