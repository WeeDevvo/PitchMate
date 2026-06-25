using PitchMate.Domain.Common;

namespace PitchMate.Application.Tests.Common.Persistence;

/// <summary>
/// A minimal <see cref="BaseEntity"/>-derived entity used solely to close the
/// generic <see cref="PitchMate.Application.Common.Persistence.IRepository{T}"/> in
/// the abstraction-signature tests. Named distinctly to avoid colliding with test
/// doubles defined by sibling tasks in this project.
/// </summary>
internal sealed class SignatureTestEntity : BaseEntity
{
    public SignatureTestEntity()
    {
    }

    public SignatureTestEntity(Guid id)
        : base(id)
    {
    }
}
