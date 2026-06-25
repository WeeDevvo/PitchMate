namespace PitchMate.Domain.Common;

/// <summary>
/// Compares two <see cref="Guid"/> values by their canonical big-endian
/// (time-ordered) byte sequence, so the result matches PostgreSQL <c>uuid</c>
/// ordering and the natural ordering of UUID version 7 identifiers.
/// <para>
/// .NET's <see cref="Guid.ToByteArray()"/> returns bytes in a mixed-endian layout
/// (the first three groups are little-endian), which does <em>not</em> match how
/// PostgreSQL sorts <c>uuid</c> columns. This comparer writes the big-endian byte
/// sequence via <see cref="Guid.TryWriteBytes(System.Span{byte}, bool, out int)"/>
/// and compares those bytes lexicographically, so in-memory ordering equals
/// database ordering.
/// </para>
/// </summary>
public sealed class UuidV7Comparer : IComparer<Guid>
{
    /// <summary>A shared, thread-safe instance of the comparer.</summary>
    public static UuidV7Comparer Instance { get; } = new();

    /// <summary>
    /// Compares two GUIDs by their big-endian byte sequence.
    /// </summary>
    /// <param name="x">The first GUID.</param>
    /// <param name="y">The second GUID.</param>
    /// <returns>
    /// A negative value when <paramref name="x"/> sorts before <paramref name="y"/>,
    /// zero when they are equal, and a positive value when <paramref name="x"/> sorts
    /// after <paramref name="y"/>.
    /// </returns>
    public static int Compare(Guid x, Guid y)
    {
        Span<byte> xBytes = stackalloc byte[16];
        Span<byte> yBytes = stackalloc byte[16];

        // bigEndian: true yields the canonical RFC 4122 byte order that PostgreSQL
        // uses to sort uuid values; for v7 IDs this is creation order.
        x.TryWriteBytes(xBytes, bigEndian: true, out _);
        y.TryWriteBytes(yBytes, bigEndian: true, out _);

        return xBytes.SequenceCompareTo(yBytes);
    }

    /// <inheritdoc />
    int IComparer<Guid>.Compare(Guid x, Guid y) => Compare(x, y);
}
