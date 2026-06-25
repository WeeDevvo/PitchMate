namespace PitchMate.Domain.Common;

/// <summary>
/// The stable chronological ordering used for rating replay: <see cref="BaseEntity.CreatedAt"/>
/// ascending first, then <see cref="BaseEntity.Id"/> ascending by its UUID version 7
/// byte sequence (via <see cref="UuidV7Comparer"/>) as the tie-breaker.
/// <para>
/// Because each <see cref="BaseEntity.Id"/> is unique, this defines a strict total order
/// over any set of records, so ordering the same records always yields the identical
/// sequence regardless of input order. <see cref="BaseEntity.CreatedAt"/> is compared at
/// its stored UTC instant (<see cref="DateTimeOffset.UtcDateTime"/>) so the in-memory
/// order matches the order evaluated inside the database.
/// </para>
/// </summary>
public sealed class ChronologicalOrder : IComparer<BaseEntity>
{
    /// <summary>A shared, thread-safe instance of the comparer.</summary>
    public static ChronologicalOrder Instance { get; } = new();

    /// <summary>
    /// Compares two entities by creation instant, then by identity.
    /// </summary>
    /// <param name="x">The first entity.</param>
    /// <param name="y">The second entity.</param>
    /// <returns>
    /// A negative value when <paramref name="x"/> sorts before <paramref name="y"/>,
    /// zero when they are the same record, and a positive value otherwise.
    /// </returns>
    /// <exception cref="ArgumentNullException">
    /// Thrown when <paramref name="x"/> or <paramref name="y"/> is <see langword="null"/>.
    /// </exception>
    public int Compare(BaseEntity? x, BaseEntity? y)
    {
        ArgumentNullException.ThrowIfNull(x);
        ArgumentNullException.ThrowIfNull(y);

        int byTime = x.CreatedAt.UtcDateTime.CompareTo(y.CreatedAt.UtcDateTime);
        return byTime != 0 ? byTime : UuidV7Comparer.Compare(x.Id, y.Id);
    }
}
