namespace PitchMate.Api;

/// <summary>
/// The response of the liveness probe, replacing the anonymous type <c>/health</c> returned before
/// (Requirements 7.3, 7.4). An anonymous type cannot be schematised at all, so the probe declares a
/// named transport record instead (D6).
/// </summary>
/// <param name="Status">The liveness status of the Api.</param>
public sealed record HealthResponse(string Status);
