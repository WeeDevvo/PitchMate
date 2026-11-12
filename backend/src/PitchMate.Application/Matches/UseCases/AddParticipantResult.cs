namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The identity produced by a successful addition: the GUID v7 identity of the created
/// <see cref="PitchMate.Domain.Matches.MatchParticipant"/> linking the membership to the match
/// (Requirement 7.1).
/// </summary>
/// <param name="ParticipantId">The identity of the created match participant.</param>
public sealed record AddParticipantResult(Guid ParticipantId);
