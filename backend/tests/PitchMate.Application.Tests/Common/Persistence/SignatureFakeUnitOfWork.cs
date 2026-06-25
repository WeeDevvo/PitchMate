using PitchMate.Application.Common.Persistence;

namespace PitchMate.Application.Tests.Common.Persistence;

/// <summary>
/// An in-memory fake <see cref="IUnitOfWork"/> whose save operation honours the
/// supplied <see cref="CancellationToken"/> via
/// <see cref="CancellationToken.ThrowIfCancellationRequested"/>, so a pre-cancelled
/// token surfaces an <see cref="OperationCanceledException"/>. Named distinctly to
/// avoid colliding with test doubles defined by sibling tasks in this project.
/// </summary>
internal sealed class SignatureFakeUnitOfWork : IUnitOfWork
{
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(0);
    }
}
