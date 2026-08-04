namespace PitchMate.Application.Stats;

/// <summary>
/// A <c>Squad_Membership</c>'s win/draw/loss record across its appearances in the squad's
/// completed matches (Requirement 6.2). The three outcome counts partition the appearances, so the
/// invariant <c>Wins + Draws + Losses == Appearances</c> always holds: every appearance yields
/// exactly one <c>Player_Result</c>. This is a read-model carrier shaped by the profile handler from
/// aggregated counts; it does not validate or enforce the invariant itself, matching the
/// behaviour-free style of the other Application read-model records.
/// </summary>
/// <param name="Appearances">Count of distinct completed matches the membership appeared in.</param>
/// <param name="Wins">Count of <c>Win</c> results (equals appearances only if every match was won).</param>
/// <param name="Draws">Count of <c>Draw</c> results.</param>
/// <param name="Losses">Count of <c>Loss</c> results.</param>
public sealed record PlayerRecord(int Appearances, int Wins, int Draws, int Losses);
