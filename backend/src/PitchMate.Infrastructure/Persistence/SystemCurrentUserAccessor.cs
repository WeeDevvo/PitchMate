using PitchMate.Application.Common;

namespace PitchMate.Infrastructure.Persistence;

/// <summary>
/// Default <see cref="ICurrentUserAccessor"/> used when no authenticated actor is available
/// (system/background operations and startup). It reports no current user, so save-time audit
/// stamping records a null actor — which the persistence layer tolerates (Req 2.6).
/// <para>
/// Registered with a <c>Try*</c> lifetime in <see cref="DependencyInjection.AddInfrastructure"/>
/// so the Api/auth layer can replace it with a request-scoped implementation that surfaces the
/// signed-in user without changing Infrastructure.
/// </para>
/// </summary>
internal sealed class SystemCurrentUserAccessor : ICurrentUserAccessor
{
    /// <inheritdoc />
    public string? CurrentUserId => null;
}
