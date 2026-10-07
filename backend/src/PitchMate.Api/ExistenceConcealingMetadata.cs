namespace PitchMate.Api;

/// <summary>
/// Marks an endpoint as <b>existence-concealing</b>: one where an authorisation failure is reported as
/// <c>404</c> rather than <c>403</c>, so a caller outside the resource's squad cannot learn whether it
/// exists (Requirements 2.3, 5.3).
/// <para>
/// The marker is attached by the concealing variant of each response convention
/// (<c>With*ConcealedProblemResponses</c>, and <c>WithStatsProblemResponses</c> whose seam conceals
/// unconditionally), so composing a concealing convention is the single act that both declares the
/// status set and records the intent behind it.
/// </para>
/// <para>
/// It exists because the intent is otherwise unobservable. For squads and matches the concealing set is
/// the standard set with <c>403</c> removed, but for notifications and live tracking the two variants
/// declare <i>identical</i> sets — their handlers and seams collapse an authorisation failure into a
/// not-found before the convention is reached — so no inspection of the declared statuses can tell a
/// concealing endpoint from an ordinary one. Without this marker the concealing-endpoint guard would
/// have to infer its own subject from the very set it is meant to check, which would make it pass
/// vacuously on exactly the endpoints most worth checking: one that composes a concealing convention
/// and then declares <c>403</c> anyway.
/// </para>
/// <para>
/// The marker carries no behaviour and is not understood by the OpenAPI document generator, so it does
/// not appear in the emitted document; it is a statement about the endpoint, readable by anything that
/// enumerates endpoint metadata.
/// </para>
/// </summary>
internal sealed class ExistenceConcealingMetadata
{
    /// <summary>
    /// The single instance to attach. The marker is stateless, so one instance serves every endpoint.
    /// </summary>
    internal static readonly ExistenceConcealingMetadata Instance = new();

    private ExistenceConcealingMetadata()
    {
    }

    /// <summary>A readable form, for failure messages that list an endpoint's metadata.</summary>
    public override string ToString() => "existence-concealing";
}
