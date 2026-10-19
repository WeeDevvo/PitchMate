using System.Text;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Http;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// <b>Property 18 — A mismatched squad is refused exactly as a non-membership is, and grants nothing.</b>
/// <para>
/// <b>Validates: Requirements 7.3, 7.4, 7.6, 7.8, 13.17</b>
/// </para>
/// <para>
/// The six squad-scoped operations gained a <c>squadId</c> they never used to bind. Binding a
/// caller-supplied identity is the moment a path parameter becomes a potential authorisation input, and the
/// only defence is that the handler refuses a squad that is not the match's own <em>before</em> the gate
/// runs. That refusal is worth very little if it is observably different from an ordinary authorisation
/// failure: a caller who can tell "wrong squad" from "not your squad" has an oracle for which squad a match
/// belongs to, and by sweeping squad identities, for which matches exist at all. So the guarantee is a fact
/// about the bytes — the refusal must be the response the same operation <em>already</em> gives a caller
/// holding no membership in the match's squad, which for the one concealing read of the six is the concealed
/// <c>404</c> and for the other five is their existing authorisation failure.
/// </para>
/// <para>
/// Three things are therefore asserted together, because any one alone is satisfiable by a broken surface.
/// Byte-identity alone would be satisfied by an operation that refuses everything. Identity plus a success
/// path would be satisfied by a refusal that had already written something before refusing. And both of
/// those would be satisfied by an implementation that merely happens to refuse <em>this</em> caller — which
/// is why the sweep includes the sharp case: an <c>Owner</c> of the squad named in the path, holding no
/// membership of the match's squad at all. Owning the squad in the URL must buy nothing.
/// </para>
/// <para>
/// Everything runs through the application's real request pipeline against real PostgreSQL, with every
/// parameter of each discovered route template supplied — which is also the end-to-end evidence that the six
/// are reachable from a generated client rather than merely described by one (Requirement 13.17).
/// </para>
/// <para>
/// Out of scope, deliberately: a missing or rejected bearer token produces the framework's <c>401</c> and is
/// not part of the concealment guarantee, which covers authenticated, subject-resolved callers only. And
/// because <c>AddProblemDetails()</c> is not registered, problem bodies carry no per-request
/// <c>traceId</c> today; the shipped <c>SeamBehaviourPreservationProperties</c> already carries that drift
/// case, so nothing here re-states it.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public sealed class SquadMismatchIndistinguishabilityProperties : IClassFixture<SquadMismatchApiFixture>
{
    private readonly SquadMismatchApiFixture _fixture;

    /// <summary>Receives the container-backed host, the seeded world and the captured baselines.</summary>
    /// <param name="fixture">The shared fixture.</param>
    public SquadMismatchIndistinguishabilityProperties(SquadMismatchApiFixture fixture)
    {
        ArgumentNullException.ThrowIfNull(fixture);

        _fixture = fixture;
    }

    /// <summary>
    /// Every combination of the six operations, the three callers and the two kinds of wrong squad — the
    /// exhaustive cross product the generated sweep samples from.
    /// </summary>
    /// <returns>One case per combination.</returns>
    public static TheoryData<SquadScopedMatchOperation, MismatchCaller, MismatchPathSquad> EveryCombination()
    {
        var data = new TheoryData<SquadScopedMatchOperation, MismatchCaller, MismatchPathSquad>();

        foreach (SquadScopedMatchOperation operation in Enum.GetValues<SquadScopedMatchOperation>())
        {
            foreach (MismatchCaller caller in Enum.GetValues<MismatchCaller>())
            {
                foreach (MismatchPathSquad pathSquad in Enum.GetValues<MismatchPathSquad>())
                {
                    data.Add(operation, caller, pathSquad);
                }
            }
        }

        return data;
    }

    /// <summary>The six operations, for the success and sharp-case theories.</summary>
    /// <returns>One case per operation.</returns>
    public static TheoryData<SquadScopedMatchOperation> EveryOperation()
    {
        var data = new TheoryData<SquadScopedMatchOperation>();

        foreach (SquadScopedMatchOperation operation in Enum.GetValues<SquadScopedMatchOperation>())
        {
            data.Add(operation);
        }

        return data;
    }

    // Feature: match-read-models, Property 18: A mismatched squad is refused exactly as a non-membership is,
    // and grants nothing — for each of the six squad-scoped operations and any squadId that is not the
    // identity of the squad the aggregate records for the request's matchId, the response is byte-for-byte
    // identical to the response that operation returns to a caller holding no membership in the match's
    // squad.
    // Validates: Requirements 7.3, 7.4, 7.6, 7.8
    [Property(MaxTest = 120, Arbitrary = [typeof(SquadMismatchScenarioGenerators)])]
    [Trait("Property", "18")]
    public Property Property18_AMismatchedSquadIsRefusedExactlyAsANonMembershipIs(SquadMismatchScenario scenario)
    {
        ArgumentNullException.ThrowIfNull(scenario);

        IReadOnlyList<string> offences = Offences(scenario);

        return (offences.Count == 0)
            .ToProperty()
            .Label(string.Join("; ", offences))
            .Collect($"{scenario.Operation} / {scenario.Caller} / {scenario.PathSquad}");
    }

    /// <summary>
    /// The exhaustive companion to the generated sweep: the same rule over all thirty-six combinations at
    /// once, so a failure reports every offender as a worklist rather than the single shrunk counterexample
    /// a property failure yields.
    /// </summary>
    /// <param name="operation">The operation under test.</param>
    /// <param name="caller">The authenticated caller.</param>
    /// <param name="pathSquad">The kind of wrong squad the path names.</param>
    [Theory]
    [MemberData(nameof(EveryCombination))]
    public void EveryMismatchedSquadIsRefusedExactlyAsANonMembershipIs(
        SquadScopedMatchOperation operation, MismatchCaller caller, MismatchPathSquad pathSquad)
    {
        var scenario = new SquadMismatchScenario(operation, caller, pathSquad, Guid.NewGuid());

        IReadOnlyList<string> offences = Offences(scenario);

        Assert.True(offences.Count == 0, Report("distinguishable squad-mismatch refusals", offences));
    }

    /// <summary>
    /// The sharp case stated on its own, because it is the one a reader is most likely to assume is safe: a
    /// caller holding an active <c>Owner</c> membership of the squad <em>named in the path</em>, and no
    /// membership whatever of the squad the match belongs to, is refused — and refused identically to a
    /// caller who owns nothing at all. If the path's <c>squadId</c> were an input to the gate, this is the
    /// request that would have been admitted (Requirement 7.6).
    /// </summary>
    /// <param name="operation">The operation under test.</param>
    [Theory]
    [MemberData(nameof(EveryOperation))]
    public void AnOwnerOfThePathSquadHoldingNoMembershipOfTheMatchsSquadIsRefused(
        SquadScopedMatchOperation operation)
    {
        var scenario = new SquadMismatchScenario(
            operation,
            MismatchCaller.OwnerOfThePathSquadOnly,
            MismatchPathSquad.AnotherRealSquad,
            Guid.NewGuid());

        // The path names a squad this caller genuinely owns, and the caller's own squad is not the match's.
        Assert.Equal(_fixture.World.OtherSquadId, _fixture.PathSquadIdFor(scenario));
        Assert.NotEqual(_fixture.World.MatchSquadId, _fixture.World.OtherSquadId);

        CapturedMatchResponse baseline = _fixture.BaselineFor(operation);
        CapturedMatchResponse actual = _fixture.SendMismatch(scenario);

        Assert.True(
            actual.IsIndistinguishableFrom(baseline),
            $"{operation} answered an owner of the path squad with '{actual}' but answers a caller with no "
                + $"membership with '{baseline}'; owning the squad named in the URL changed the response.");
    }

    /// <summary>
    /// Requirement 7.4's second half: the refusal mutates no persisted state. Asserted over the whole
    /// thirty-six-case sweep at once, by comparing every column of every match, participant, team,
    /// availability-response, squad and membership row before and after.
    /// <para>
    /// Comparing full rows rather than the handful of columns an operation would have written is what makes
    /// this catch the quiet failure: an unintended <c>SaveChanges</c> on the refusal path would stamp an
    /// <c>updated_at</c> and an <c>updated_by</c> without changing anything a reader would notice.
    /// </para>
    /// </summary>
    [Fact]
    public async Task TheMismatchSweepLeavesThePersistedStateUnchanged()
    {
        string before = await _fixture.CapturePersistedStateAsync();

        var refusals = new List<CapturedMatchResponse>();

        foreach (SquadScopedMatchOperation operation in Enum.GetValues<SquadScopedMatchOperation>())
        {
            foreach (MismatchCaller caller in Enum.GetValues<MismatchCaller>())
            {
                foreach (MismatchPathSquad pathSquad in Enum.GetValues<MismatchPathSquad>())
                {
                    refusals.Add(_fixture.SendMismatch(
                        new SquadMismatchScenario(operation, caller, pathSquad, Guid.NewGuid())));
                }
            }
        }

        string after = await _fixture.CapturePersistedStateAsync();

        // The sweep genuinely ran, and ran against a database holding the very rows these operations write
        // — otherwise "unchanged" would be a statement about nothing. The probe match and a participant of
        // it appear in the snapshot by identity, so the comparison is over populated tables. (match_team is
        // legitimately empty: no seeded match has rolled its teams, and none of the six rolls them.)
        Assert.Equal(36, refusals.Count);
        Assert.DoesNotContain("match = []", before, StringComparison.Ordinal);
        Assert.DoesNotContain("match_participant = []", before, StringComparison.Ordinal);
        Assert.DoesNotContain("availability_response = []", before, StringComparison.Ordinal);
        Assert.Contains(_fixture.World.ProbeMatchId.ToString(), before, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(
            _fixture.World.ProbeParticipantMembershipId.ToString(), before, StringComparison.OrdinalIgnoreCase);

        Assert.Equal(before, after);
    }

    /// <summary>
    /// The other half of Requirement 7.8: a request carrying the match's <em>own</em> <c>squadId</c> reaches
    /// the operation and returns its success response. Without this the refusal half would hold over six
    /// operations that could never have succeeded, and the property would be measuring a fixture rather than
    /// a behaviour.
    /// <para>
    /// It is also the end-to-end proof of Requirement 13.17 for these six: each is called through the real
    /// pipeline with every path parameter of its own route pattern supplied, and produces the success status
    /// it produces today.
    /// </para>
    /// </summary>
    /// <param name="operation">The operation under test.</param>
    [Theory]
    [MemberData(nameof(EveryOperation))]
    public void EachOperationCarryingTheMatchsOwnSquadReachesTheOperationAndSucceeds(
        SquadScopedMatchOperation operation)
    {
        SquadScopedMatchSuccessCase success = _fixture.SuccessCaseFor(operation);

        CapturedMatchResponse actual = _fixture.SendSuccess(operation);

        Assert.Equal(success.ExpectedStatus, actual.Status);

        // A 204 carries no body; a 200 carries the operation's declared contract rather than an empty one.
        if (success.ExpectedStatus == StatusCodes.Status204NoContent)
        {
            Assert.Empty(actual.Body);
        }
        else
        {
            Assert.True(
                actual.RootMemberCount > 0,
                $"{operation} succeeded with the body '{actual.BodyText}', which carries no member of its "
                    + "declared contract.");
        }
    }

    /// <summary>
    /// The non-vacuity floor. Without it every assertion above is satisfied by an empty set — which is
    /// precisely what a discovery regression produces: the guard goes green at the moment it stops having a
    /// subject.
    /// <para>
    /// All six operations are found <em>on the running host</em> by the name each endpoint declares; each
    /// route template names both <c>squadId</c> and <c>matchId</c>; each has a captured baseline; and every
    /// baseline is a refusal, carrying the status Requirement 7.4 names for that operation — the concealed
    /// <c>404</c> for the tally read, the existing authorisation failure for the other five — over a
    /// non-empty problem body, so byte-equality is not holding because two bodies are both empty.
    /// </para>
    /// </summary>
    [Fact]
    public void TheDiscoveredOperationSetAndItsBaselinesAreNonVacuous()
    {
        Assert.Equal(Enum.GetValues<SquadScopedMatchOperation>().Length, _fixture.Routes.Count);
        Assert.Equal(6, _fixture.Routes.Count);

        foreach (SquadScopedMatchOperation operation in Enum.GetValues<SquadScopedMatchOperation>())
        {
            SquadScopedMatchRoute route = _fixture.RouteFor(operation);

            Assert.Contains("squadId", route.Parameters, StringComparer.OrdinalIgnoreCase);
            Assert.Contains("matchId", route.Parameters, StringComparer.OrdinalIgnoreCase);

            CapturedMatchResponse baseline = _fixture.BaselineFor(operation);

            int expected = operation == SquadScopedMatchOperation.GetAvailabilityTally
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status403Forbidden;

            Assert.Equal(expected, baseline.Status);

            Assert.True(
                baseline.RootMemberCount >= 3,
                $"{operation}'s baseline refusal wrote a body with {baseline.RootMemberCount} root "
                    + $"member(s): '{baseline.BodyText}'. Byte-equality over a near-empty body proves "
                    + "nothing.");
        }

        // RemoveParticipant is the one of the six whose template names a third parameter; its presence
        // confirms the sweep substitutes every parameter rather than only the two it shares.
        Assert.Contains(
            "membershipId",
            _fixture.RouteFor(SquadScopedMatchOperation.RemoveParticipant).Parameters,
            StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The discriminating control. The comparison must be capable of reporting a difference, or "identical"
    /// is not a finding.
    /// <para>
    /// Two independent checks. First, two baselines of the shipped surface that genuinely differ — the
    /// concealing tally read's <c>404</c> against another operation's authorisation failure — are reported as
    /// distinguishable, so the comparison is not returning <see langword="true"/> for everything. Second, a
    /// baseline altered by a single byte of its <c>detail</c> — the shape a seam takes the moment it starts
    /// echoing the error's message to be more helpful — is reported, so the comparison is over the bytes and
    /// not over the status alone.
    /// </para>
    /// </summary>
    [Fact]
    public void TheComparisonReportsAResponseThatDiffersInStatusOrInASingleByte()
    {
        CapturedMatchResponse concealed = _fixture.BaselineFor(SquadScopedMatchOperation.GetAvailabilityTally);
        CapturedMatchResponse disclosing = _fixture.BaselineFor(SquadScopedMatchOperation.ConfirmMatch);

        Assert.False(
            concealed.IsIndistinguishableFrom(disclosing),
            "The concealing tally refusal and a disclosing authorisation failure compared equal; the "
                + "comparison cannot tell any two responses apart.");

        var nudged = new CapturedMatchResponse(
            disclosing.Status,
            Encoding.UTF8.GetBytes(disclosing.BodyText.Replace(
                "not permitted", "not permitted.", StringComparison.Ordinal)));

        Assert.NotEqual(disclosing.BodyText, nudged.BodyText);
        Assert.False(
            disclosing.IsIndistinguishableFrom(nudged),
            "A body differing only in its detail compared equal; the comparison is not over the bytes.");
    }

    /// <summary>
    /// Applies the rule to one scenario and returns one message per offence, each naming the operation, the
    /// caller, the squad identity the path carried, and the fact at fault.
    /// </summary>
    private IReadOnlyList<string> Offences(SquadMismatchScenario scenario)
    {
        Guid pathSquadId = _fixture.PathSquadIdFor(scenario);

        var offences = new List<string>();

        // The case must genuinely be a mismatch, or the comparison is between a request and itself.
        if (pathSquadId == _fixture.World.MatchSquadId)
        {
            offences.Add(
                $"{scenario} addressed the match's own squad {pathSquadId}; the case is not a mismatch.");

            return offences;
        }

        CapturedMatchResponse baseline = _fixture.BaselineFor(scenario.Operation);
        CapturedMatchResponse actual = _fixture.SendMismatch(scenario);

        if (actual.Status != baseline.Status)
        {
            offences.Add(
                $"{scenario} (path squad {pathSquadId}) answered with {actual.Status} but a caller holding "
                    + $"no membership in the match's squad is answered with {baseline.Status}; the "
                    + "mismatched squad is distinguishable by status alone.");
        }
        else if (!actual.IsIndistinguishableFrom(baseline))
        {
            offences.Add(
                $"{scenario} (path squad {pathSquadId}) wrote the body '{actual.BodyText}' but a caller "
                    + $"holding no membership writes '{baseline.BodyText}'; the mismatched squad is "
                    + "recoverable from the body.");
        }

        return offences;
    }

    /// <summary>Renders every offender in one message, so the output is a worklist.</summary>
    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));
}
