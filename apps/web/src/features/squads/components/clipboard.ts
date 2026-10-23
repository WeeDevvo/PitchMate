/**
 * Copy text to the clipboard, reporting whether it worked rather than throwing.
 * Shared by the one-time reveals (invite and claim links), which announce the
 * outcome either way.
 *
 * A clipboard is absent in more situations than a failure: an insecure context, a
 * permission the person declined, an older engine, and a test environment without
 * the API. All of them arrive here as the same `false`, and the failure copy tells
 * the person to select the link by hand — which is possible because the link is
 * rendered as ordinary selectable text.
 */
export async function writeToClipboard(value: string): Promise<boolean> {
  try {
    const clipboard: Clipboard | undefined = navigator.clipboard;

    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      return false;
    }

    await clipboard.writeText(value);
    return true;
  } catch {
    // Deliberately swallowed rather than logged: a rejection reason here could
    // carry the value that was being written (Requirement 11.7).
    return false;
  }
}
