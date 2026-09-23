using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// An <see cref="ISquadRepository"/> stand-in whose only read resolves every identity to one
/// non-deleted squad. The guest-claim handlers consult it to rule out a missing or pending-deletion
/// squad, which is a failure the already-member guard is not about: the squad always exists, so the
/// rejection under test is reached rather than pre-empted by the uniform authorisation failure.
/// </summary>
internal sealed class ResolvingSquadRepository : ISquadRepository
{
    private readonly Squad _squad = Squad.Create("Already-member guard squad").Value!;

    /// <inheritdoc />
    public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult<Squad?>(_squad);

    // --- Every other member is outside the surface this guard drives. ---

    /// <inheritdoc />
    public Task AddAsync(Squad squad, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public void RemovePermanently(Squad squad) => throw Unsupported();

    private static NotSupportedException Unsupported() => new(
        "This squad repository stand-in supports only the existence read a guest-claim path performs.");
}
