namespace PitchMate.Domain.Common;

/// <summary>
/// Marks an entity that holds personally identifying information (PII) and can
/// strip it on erasure. Under PitchMate's GDPR posture, erasure means anonymisation:
/// PII is removed while the de-identified row is retained so that immutable matches
/// and rating replay stay valid.
/// </summary>
public interface IAnonymisable
{
    /// <summary>
    /// Replaces this entity's PII members with fixed de-identified placeholder values,
    /// retaining none of the original identifying content (for example a display name
    /// becomes a constant placeholder and an avatar reference is cleared).
    /// <para>
    /// This operation leaves the entity's <c>Id</c>, its relationships to other
    /// entities, its non-PII members, and its soft-delete state (<c>IsDeleted</c> and
    /// <c>DeletedAt</c>) unchanged.
    /// </para>
    /// <para>
    /// The operation is idempotent: performing it on an entity whose PII members
    /// already hold de-identified placeholder values completes without error and
    /// leaves those members holding de-identified placeholders.
    /// </para>
    /// </summary>
    void Anonymise();
}
