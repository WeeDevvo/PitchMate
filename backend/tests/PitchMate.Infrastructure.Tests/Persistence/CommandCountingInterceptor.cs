using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// A reusable EF Core <see cref="DbCommandInterceptor"/> that records every database command a
/// context executes, exposing both the <b>number</b> of commands and the <b>text</b> of each
/// (match-read-models task 5.4).
/// <para>
/// Two assertions need it, which is why it carries both halves rather than only a counter. The
/// captured-SQL assertions need the statement's text, to show that the ordering, the bound and the
/// participant count are evaluated inside the database and that no denormalised summary table is
/// read (Requirement 1.12). The round-trip assertions need the count, to show a read's command
/// budget is fixed whatever the data volume (Requirement 1.13) — the same measurement design
/// Property 25 makes over all three match reads.
/// </para>
/// <para>
/// <b>What counts as a command.</b> One recording per completed round trip: the
/// <c>…Executed</c> hooks for readers, scalars and non-queries, synchronous and asynchronous alike,
/// plus <see cref="CommandFailed(DbCommand, CommandErrorEventData)"/> — a command that reached the
/// server and threw still cost a round trip, so leaving it out would let a failing read look cheaper
/// than a succeeding one. Opening a connection, beginning a transaction and reading rows from an
/// open reader are <em>not</em> commands and are deliberately not counted.
/// </para>
/// <para>
/// <b>Lifetime.</b> Register one instance per measured operation and read it afterwards, or call
/// <see cref="Reset"/> between operations. The recordings are guarded by a lock because EF may invoke
/// the hooks from whichever thread continues an asynchronous query.
/// </para>
/// </summary>
internal sealed class CommandCountingInterceptor : DbCommandInterceptor
{
    private readonly object _gate = new();
    private readonly List<string> _commandTexts = [];

    /// <summary>The number of commands executed since construction or the last <see cref="Reset"/>.</summary>
    public int ExecutedCommandCount
    {
        get
        {
            lock (_gate)
            {
                return _commandTexts.Count;
            }
        }
    }

    /// <summary>
    /// The text of each executed command, in execution order. Returned as a snapshot copy so a
    /// caller can assert over it while the context that produced it is still alive.
    /// </summary>
    public IReadOnlyList<string> CommandTexts
    {
        get
        {
            lock (_gate)
            {
                return [.. _commandTexts];
            }
        }
    }

    /// <summary>
    /// The text of the one and only executed command, failing with the recorded count when the
    /// operation executed anything other than exactly one.
    /// </summary>
    public string SingleCommandText
    {
        get
        {
            IReadOnlyList<string> texts = CommandTexts;
            if (texts.Count != 1)
            {
                throw new InvalidOperationException(
                    $"Expected exactly one executed command but {texts.Count} were recorded:{Environment.NewLine}" +
                    string.Join($"{Environment.NewLine}---{Environment.NewLine}", texts));
            }

            return texts[0];
        }
    }

    /// <summary>Discards every recording, so one instance can measure successive operations.</summary>
    public void Reset()
    {
        lock (_gate)
        {
            _commandTexts.Clear();
        }
    }

    /// <inheritdoc />
    public override DbDataReader ReaderExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result)
    {
        Record(command);
        return base.ReaderExecuted(command, eventData, result);
    }

    /// <inheritdoc />
    public override ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        Record(command);
        return base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
    }

    /// <inheritdoc />
    public override object? ScalarExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        object? result)
    {
        Record(command);
        return base.ScalarExecuted(command, eventData, result);
    }

    /// <inheritdoc />
    public override ValueTask<object?> ScalarExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        object? result,
        CancellationToken cancellationToken = default)
    {
        Record(command);
        return base.ScalarExecutedAsync(command, eventData, result, cancellationToken);
    }

    /// <inheritdoc />
    public override int NonQueryExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        int result)
    {
        Record(command);
        return base.NonQueryExecuted(command, eventData, result);
    }

    /// <inheritdoc />
    public override ValueTask<int> NonQueryExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        Record(command);
        return base.NonQueryExecutedAsync(command, eventData, result, cancellationToken);
    }

    /// <inheritdoc />
    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData)
    {
        Record(command);
        base.CommandFailed(command, eventData);
    }

    /// <inheritdoc />
    public override Task CommandFailedAsync(
        DbCommand command,
        CommandErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Record(command);
        return base.CommandFailedAsync(command, eventData, cancellationToken);
    }

    private void Record(DbCommand command)
    {
        lock (_gate)
        {
            _commandTexts.Add(command.CommandText);
        }
    }
}
