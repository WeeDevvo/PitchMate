namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One generated subject for the persistence-member walk: a non-empty set of contracts that must be
/// reported <b>clean</b>, and a possibly-empty set of contracts that must each be <b>reported</b>.
/// <para>
/// Generating a <i>mixture</i> rather than a single shape is what makes the discriminating half a
/// statement about the rule and not about one hand-picked case. A rule that reported everything satisfies
/// "the planted shape fails"; a rule that reported nothing satisfies "the clean shapes pass"; only a rule
/// that reports exactly the planted roots out of an arbitrary mixture satisfies both at once. Letting the
/// planted set be <b>empty</b> on some cases closes the last gap — the rule must fall silent when there
/// is nothing to find, over a population it was not told was clean.
/// </para>
/// </summary>
/// <param name="Clean">Contracts whose reachable graph carries no persistence member.</param>
/// <param name="Planted">Contracts that reach at least one member declared by the persistence base entity.</param>
public sealed record PersistenceMemberWalkCase(
    IReadOnlyList<Type> Clean,
    IReadOnlyList<Type> Planted)
{
    /// <summary>The whole set handed to the rule, in one pass, clean and planted intermixed.</summary>
    public IReadOnlyList<Type> Walked => [.. Clean.Concat(Planted)];

    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() =>
        $"clean [{string.Join(", ", Clean.Select(static contract => contract.Name))}] "
            + $"+ planted [{string.Join(", ", Planted.Select(static contract => contract.Name))}]";

    /// <summary>
    /// How this case is classified in the FsCheck distribution: whether anything was planted, and how
    /// much. A run that only ever drew the empty planted set would be visible here rather than passing
    /// quietly.
    /// </summary>
    public string Classification => Planted.Count switch
    {
        0 => "nothing planted",
        1 => "one planted contract",
        _ => $"{Planted.Count} planted contracts",
    };
}
