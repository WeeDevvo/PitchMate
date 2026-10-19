namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The calling member's own stored availability response for a match (Requirements 3.2, 3.3).
/// <para>
/// The two members are <b>independent and always present</b>. <see cref="HasStoredResponse"/> is the
/// sole discriminator between "a stored response marking no day" (<see langword="true"/>, empty) and
/// "no stored response" (<see langword="false"/>, empty), so the distinction survives a consumer that
/// treats an omitted member and a null member as the same absence, and is never recoverable from
/// <see cref="MarkedDays"/> alone.
/// </para>
/// </summary>
/// <param name="HasStoredResponse">Whether the caller has stored a response for this match.</param>
/// <param name="MarkedDays">The candidate days the stored response marks, as bare UTC instants; empty when none are marked or nothing is stored.</param>
public sealed record CallerAvailability(
    bool HasStoredResponse,
    IReadOnlyList<DateTimeOffset> MarkedDays);
