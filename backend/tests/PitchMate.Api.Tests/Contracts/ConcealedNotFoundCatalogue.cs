namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Executes every concealing seam's masked failures once and holds the captured responses, so the
/// guard's quantification runs over values rather than over I/O.
/// <para>
/// Capturing up front is what lets the FsCheck property draw from a materialised set: a generator
/// cannot await, and blocking on the execution inside one would be both slower and a deadlock risk
/// under the test runner's synchronisation context. The fixture's asynchronous initialisation does the
/// work once for the whole class instead.
/// </para>
/// <para>
/// <see cref="Pairs"/> is every unordered pair of distinct failures within a seam — the exact
/// quantification Property 10 states, and finite, so the property is exhaustive over its real input
/// space rather than sampling it.
/// </para>
/// </summary>
public sealed class ConcealedNotFoundCatalogue : IAsyncLifetime
{
    /// <summary>Every captured concealed response, in catalogue order.</summary>
    public IReadOnlyList<CapturedResponse> Concealed { get; private set; } = [];

    /// <summary>Every unordered pair of distinct concealed responses within a single seam.</summary>
    public IReadOnlyList<ConcealedPair> Pairs { get; private set; } = [];

    /// <summary>
    /// The captured disclosing results — one per seam — that the guard's controls require the rule to
    /// report.
    /// </summary>
    public IReadOnlyList<CapturedResponse> Disclosing { get; private set; } = [];

    /// <summary>Captures every catalogued result by executing the real seam.</summary>
    /// <returns>A task that completes once every response is captured.</returns>
    public async Task InitializeAsync()
    {
        Concealed = await CaptureAllAsync(ConcealingSeams.All);
        Disclosing = await CaptureAllAsync(ConcealingSeams.DisclosingControls);

        Pairs =
        [
            .. Concealed
                .GroupBy(static response => response.SeamName, StringComparer.Ordinal)
                .SelectMany(static seam => UnorderedPairs([.. seam])),
        ];
    }

    /// <inheritdoc />
    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>The captured concealed responses of one seam, in catalogue order.</summary>
    /// <param name="seamName">The seam to filter by.</param>
    /// <returns>That seam's captured concealed responses.</returns>
    public IReadOnlyList<CapturedResponse> ConcealedBy(string seamName) =>
        [.. Concealed.Where(response => string.Equals(response.SeamName, seamName, StringComparison.Ordinal))];

    /// <summary>The captured concealed pairs of one seam.</summary>
    /// <param name="seamName">The seam to filter by.</param>
    /// <returns>That seam's captured pairs.</returns>
    public IReadOnlyList<ConcealedPair> PairsOf(string seamName) =>
        [.. Pairs.Where(pair => string.Equals(pair.SeamName, seamName, StringComparison.Ordinal))];

    private static async Task<IReadOnlyList<CapturedResponse>> CaptureAllAsync(
        IReadOnlyList<ConcealedFailure> failures)
    {
        var captured = new List<CapturedResponse>(failures.Count);

        foreach (ConcealedFailure failure in failures)
        {
            captured.Add(await CapturedResponse.CaptureAsync(failure));
        }

        return captured;
    }

    private static IEnumerable<ConcealedPair> UnorderedPairs(IReadOnlyList<CapturedResponse> responses)
    {
        for (int left = 0; left < responses.Count; left++)
        {
            for (int right = left + 1; right < responses.Count; right++)
            {
                yield return new ConcealedPair(
                    responses[left].SeamName, responses[left], responses[right]);
            }
        }
    }
}
