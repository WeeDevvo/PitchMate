using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// One mapped table of the model, resolved to its table name and the store object its column names
/// are read against, so the raw read-model SQL names tables and columns from the EF model rather than
/// restating them.
/// </summary>
internal readonly struct MappedTable
{
    private readonly IEntityType _entity;
    private readonly StoreObjectIdentifier _store;

    private MappedTable(IEntityType entity, string table, StoreObjectIdentifier store)
    {
        _entity = entity;
        Table = table;
        _store = store;
    }

    /// <summary>The entity's table name as the model maps it.</summary>
    public string Table { get; }

    /// <summary>Resolves the mapped table of <paramref name="clrType"/> from the model.</summary>
    public static MappedTable For(IModel model, Type clrType)
    {
        IEntityType entity = model.FindEntityType(clrType)
            ?? throw new InvalidOperationException($"{clrType.Name} is not mapped.");
        string table = entity.GetTableName()
            ?? throw new InvalidOperationException($"{clrType.Name} has no table name.");

        return new MappedTable(entity, table, StoreObjectIdentifier.Table(table, entity.GetSchema()));
    }

    /// <summary>Resolves the column <paramref name="propertyName"/> is mapped to.</summary>
    public string Column(string propertyName) =>
        _entity.FindProperty(propertyName)?.GetColumnName(_store)
        ?? throw new InvalidOperationException(
            $"{_entity.ClrType.Name}.{propertyName} is not mapped to a column.");
}
