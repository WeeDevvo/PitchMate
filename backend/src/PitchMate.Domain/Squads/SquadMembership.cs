using PitchMate.Domain.Common;

namespace PitchMate.Domain.Squads;

/// <summary>
/// Binds a player to one squad and carries that player's squad-scoped state. Backed by either a
/// registered user or a guest.
/// <para>
/// NOTE: This is a minimal placeholder introduced by task 2 so the <see cref="Squad.Memberships"/>
/// navigation compiles. Its fields, factories, role transitions, and lifecycle behaviour are
/// implemented by task 3.
/// </para>
/// </summary>
public sealed class SquadMembership : BaseEntity
{
}
