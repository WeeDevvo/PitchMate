namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Executes every error code of every seam variant once, classifies each response against that seam's
/// concealed not-found, and holds the results — so the guard's quantification runs over values rather
/// than over I/O.
/// <para>
/// Capturing up front is what lets the FsCheck property draw from a materialised set: a generator
/// cannot await, and blocking on the execution inside one would be both slower and a deadlock risk
/// under the test runner's synchronisation context. The fixture's asynchronous initialisation does the
/// work once for the whole class instead.
/// </para>
/// <para>
/// The classification is a byte comparison against the real <c>Concealed()</c> result of the same seam
/// — see <see cref="SeamProblem"/> for why that, rather than a list of code names, is the honest
/// definition of "answered by a concealed not-found".
/// </para>
/// </summary>
public sealed class ProblemCodeCatalogue : IAsyncLifetime
{
    /// <summary>Every driven error code with its captured response, in catalogue order.</summary>
    public IReadOnlyList<SeamProblem> Problems { get; private set; } = [];

    /// <summary>
    /// The codes whose responses are <b>not</b> the seam's concealed not-found — the population
    /// Property 11 ranges over, each of which must carry its branchable code.
    /// </summary>
    public IReadOnlyList<SeamProblem> NonConcealed { get; private set; } = [];

    /// <summary>
    /// The codes answered by a concealed not-found. Outside the rule by Requirement 5.2, and the
    /// guard's control population: the rule must report every one of them if applied, which is what
    /// shows it is not satisfied by any body at all.
    /// </summary>
    public IReadOnlyList<SeamProblem> ConcealedByNotFound { get; private set; } = [];

    /// <summary>Captures and classifies every seam call by executing the real seam.</summary>
    /// <returns>A task that completes once every response is captured.</returns>
    public async Task InitializeAsync()
    {
        var concealedControls = new Dictionary<string, CapturedResponse>(StringComparer.Ordinal);

        foreach ((string seamName, ConcealedFailure control) in ProblemSeams.ConcealedControls)
        {
            concealedControls[seamName] = await CapturedResponse.CaptureAsync(control);
        }

        var problems = new List<SeamProblem>(ProblemSeams.All.Count);

        foreach (ProblemSeamCall call in ProblemSeams.All)
        {
            CapturedResponse response = await CapturedResponse.CaptureAsync(call.Call);

            bool isConcealed = concealedControls.TryGetValue(call.SeamName, out CapturedResponse? concealed)
                && response.Status == concealed.Status
                && response.Body.SequenceEqual(concealed.Body);

            problems.Add(new SeamProblem(
                call.SeamName,
                call.VariantName,
                call.ErrorCodeType,
                call.CodeName,
                response,
                isConcealed));
        }

        Problems = problems;
        NonConcealed = [.. problems.Where(static problem => !problem.IsConcealedNotFound)];
        ConcealedByNotFound = [.. problems.Where(static problem => problem.IsConcealedNotFound)];
    }

    /// <inheritdoc />
    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>The driven codes of one (seam, variant) pairing, in catalogue order.</summary>
    /// <param name="seamVariant">The pairing, as <see cref="SeamProblem.SeamVariant"/> renders it.</param>
    /// <returns>That pairing's driven codes.</returns>
    public IReadOnlyList<SeamProblem> Of(string seamVariant) =>
        [.. Problems.Where(problem => string.Equals(problem.SeamVariant, seamVariant, StringComparison.Ordinal))];
}
