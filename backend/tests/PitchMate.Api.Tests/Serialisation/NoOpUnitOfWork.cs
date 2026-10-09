using PitchMate.Application.Common.Persistence;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// A unit of work that commits nothing. The mark-all-read handler ends by committing its flips, which
/// the real EF Core unit of work would do against a database this in-memory host has no connection to.
/// Nothing under test depends on the commit: the count the envelope carries is the number of records the
/// handler flipped in memory, which is settled before the commit is reached.
/// </summary>
internal sealed class NoOpUnitOfWork : IUnitOfWork
{
    /// <inheritdoc />
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken) => Task.FromResult(0);
}
