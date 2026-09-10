/**
 * The Theme_Provider — the App_Shell's live appearance behaviour.
 *
 * The pre-paint bootstrap (`THEME_BOOTSTRAP_SOURCE`, injected into `index.html`'s
 * `<head>` by the `transformIndexHtml` hook in `vite.config.ts`) has already put
 * the resolved Theme on the document element before this component's first
 * render, so nothing here fights a flash of the wrong Theme (Requirement 12.13).
 * This provider owns everything that happens *after* that first paint:
 *
 * - it holds the Appearance_Preference, read once from the single namespaced
 *   storage key, where an absent, unrecognised, or unreadable value means
 *   `system` and surfaces no error (Requirement 12.6);
 * - it re-resolves the Theme live when the browser appearance preference changes
 *   while the preference is `system`, mutating the existing document rather than
 *   reloading it (Requirement 12.7);
 * - it adopts a value written by another browsing context of the same
 *   application through the `storage` event, again with no reload
 *   (Requirement 12.15);
 * - it exposes the resolved Theme, the current preference, and a setter, so the
 *   Appearance_Preference_Control can report the selected option and change it
 *   (Requirements 12.4, 12.5); and
 * - it honours a selection whose write was rejected for the rest of the session,
 *   in memory (Requirement 12.14).
 *
 * ### One implementation of resolution
 *
 * Nothing is decided here. The preference read/write, the interpretation rule,
 * the resolution rule, the media query, and the attribute name all come from the
 * shared `src/theme` module, so this provider and the pre-paint bootstrap cannot
 * disagree (Requirements 12.12, 15.7). This file is the *wiring*: React state,
 * two subscriptions, and one attribute write.
 *
 * The import reaches `src/theme` directly rather than through the shell's
 * `lib/theme` re-export, because that re-export is one of the React-free and
 * DOM-free `lib/` modules (Requirements 14.16, 15.5) and so carries only the pure
 * half of the module. The storage read/write and the attribute write touch
 * browser globals and therefore belong on this side of the boundary, where a
 * component already may.
 *
 * ### Why the preference is state and the browser preference is not
 *
 * The browser appearance preference is a pure external value, so it is read
 * through `useSyncExternalStore`: the first render already sees the current
 * value, a change between render and subscription cannot be missed, and
 * concurrent renders read one consistent value.
 *
 * The Appearance_Preference cannot be derived from storage the same way, because
 * Requirement 12.14 requires a selection whose write was rejected to stand for
 * the remainder of the session. Storage would keep reporting the old value, so
 * the selection lives in React state and storage is written best-effort beside
 * it. The next start of the application reads storage again and so falls back to
 * `system`, which is exactly what 12.14 asks for.
 *
 * Requirements: 12.5, 12.6, 12.7, 12.14, 12.15
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  LIGHT_APPEARANCE_QUERY,
  applyThemeAttribute,
  interpretStoredPreference,
  readAppearancePreference,
  resolveTheme,
  writeAppearancePreference,
  type AppearancePreference,
  type AppearanceStorage,
  type Theme,
  type ThemeAttributeTarget,
} from '../../../theme';

/**
 * What the shell exposes about appearance.
 *
 * Both the resolved Theme and the raw preference are published, because they
 * answer different questions: the Theme is what is rendered, the preference is
 * what the person chose. The Appearance_Preference_Control needs the preference
 * to report the selected option — a resolved Theme of `dark` cannot distinguish
 * `system` from `dark` (Requirement 12.4).
 */
export interface ShellTheme {
  /** The Theme in force, already applied to the document element. */
  readonly theme: Theme;
  /** The Appearance_Preference the person chose: `system`, `dark`, or `light`. */
  readonly preference: AppearancePreference;
  /**
   * Adopt a new Appearance_Preference.
   *
   * The value takes effect immediately and is written to storage best-effort. A
   * rejected or impossible write is not reported and not an error: the value
   * still stands for the remainder of the session (Requirement 12.14).
   *
   * Stable across renders, so it can be named in a dependency list.
   */
  readonly setPreference: (preference: AppearancePreference) => void;
}

/**
 * Evaluate the light-appearance media query, or `null` where the environment
 * cannot.
 *
 * `window.matchMedia` is looked up per call rather than captured at module
 * scope: a capture would bind whatever existed at import time, which breaks
 * stubbing in tests and misses a late-installed polyfill.
 */
function lightAppearanceQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  try {
    return window.matchMedia(LIGHT_APPEARANCE_QUERY);
  } catch {
    // A rejected query is an absent one — dark-mode-first means no explicit
    // light preference, never a failure.
    return null;
  }
}

/**
 * Whether the browser reports an *explicit* light appearance preference.
 *
 * Only the light query is consulted, because only an explicit light preference
 * can pull the resolved Theme away from dark. A browser expressing no
 * preference, and an environment with no usable `matchMedia` (jsdom included),
 * both report `false`.
 */
function readBrowserPrefersLight(): boolean {
  return lightAppearanceQuery()?.matches === true;
}

/**
 * Subscribe to browser appearance-preference changes.
 *
 * Declared at module scope so its identity is stable and React never tears down
 * a live subscription to install an identical one. The event's own `matches` is
 * ignored: React re-reads the snapshot, which keeps one code path reading the
 * preference.
 */
function subscribeToBrowserPreference(onStoreChange: () => void): () => void {
  const query = lightAppearanceQuery();
  if (query === null) {
    // Nothing to observe, so the snapshot cannot change either.
    return () => {};
  }

  const handleChange = (): void => {
    onStoreChange();
  };

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handleChange);
    return () => {
      query.removeEventListener('change', handleChange);
    };
  }

  // Safari before 14 and Chrome before 39 expose only the deprecated pair.
  const legacy = query as MediaQueryList & {
    addListener?: (listener: () => void) => void;
    removeListener?: (listener: () => void) => void;
  };
  if (typeof legacy.addListener === 'function') {
    legacy.addListener(handleChange);
    return () => {
      legacy.removeListener?.(handleChange);
    };
  }

  // A `matchMedia` offering neither: the current value is still usable, there is
  // just no notification of a change.
  return () => {};
}

/**
 * The server snapshot. There is no server render today; dark-mode-first makes
 * "no explicit light preference" the right answer if there ever is one.
 */
function serverPrefersLight(): boolean {
  return false;
}

const ShellThemeContext = createContext<ShellTheme | undefined>(undefined);

/**
 * Read the resolved Theme, the Appearance_Preference, and the setter.
 *
 * Throws outside a {@link ShellThemeProvider}, following the Auth_Feature's
 * `useAuth` convention: a surface that believes it can change the appearance but
 * silently cannot is a wiring mistake, not a state with a safe meaning.
 *
 * Requirements: 12.4, 12.5, 12.7, 12.15
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + its context hook are intentionally co-located
export function useShellTheme(): ShellTheme {
  const value = useContext(ShellThemeContext);
  if (value === undefined) {
    throw new Error('useShellTheme must be used within a ShellThemeProvider');
  }
  return value;
}

export interface ShellThemeProviderProps {
  readonly children: ReactNode;
  /**
   * Browser storage holding the Appearance_Preference. Omit to use the ambient
   * storage; pass `null` to model storage being unavailable, which resolves to
   * `system` with no error (Requirements 12.6, 12.14).
   */
  readonly storage?: AppearanceStorage | null;
  /**
   * Element the resolved Theme is recorded on. Omit to use the ambient document
   * element; pass `null` to write nowhere.
   */
  readonly themeTarget?: ThemeAttributeTarget | null;
}

/**
 * Resolve the Theme, keep it live, and publish it to the Shell_Frame and every
 * Destination_Content.
 *
 * Renders no element of its own — only the context provider around `children` —
 * so it can sit anywhere in the shell's tree without affecting the landmark
 * structure. In the shell's route table it sits directly inside the RouteGuard
 * and above the Squad_Scope and notification providers, so every authenticated
 * surface reads one Theme.
 *
 * Requirements: 12.5, 12.6, 12.7, 12.14, 12.15
 */
export function ShellThemeProvider({
  children,
  storage,
  themeTarget,
}: ShellThemeProviderProps): ReactElement {
  // 12.6: read once, at mount. Unavailable storage, a rejected read, an absent
  // key, and an unrecognised value all yield `system`, and none is an error.
  const [preference, setPreferenceState] = useState<AppearancePreference>(() =>
    readAppearancePreference(storage),
  );

  // 12.7: the browser side of the resolution, re-read on every change of the
  // light-appearance query.
  const browserPrefersLight = useSyncExternalStore(
    subscribeToBrowserPreference,
    readBrowserPrefersLight,
    serverPrefersLight,
  );

  // 12.12: the one pure resolution, over the two inputs the bootstrap uses.
  const theme = resolveTheme(preference, browserPrefersLight);

  const setPreference = useCallback(
    (next: AppearancePreference): void => {
      // 12.14: state first and unconditionally — the selection stands for the
      // session whatever storage does with it.
      setPreferenceState(next);
      // 12.5: best-effort persistence under the single namespaced key. The
      // result is deliberately unused: a rejected write surfaces nothing.
      writeAppearancePreference(next, storage);
    },
    [storage],
  );

  // 12.15: another browsing context of the same application changed the stored
  // value. Adopt it, interpreting an absent or unrecognised value as `system`,
  // so two open contexts cannot display differing Themes.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorage = (event: StorageEvent): void => {
      // A `null` key means the whole store was cleared, which removes the
      // Appearance_Preference along with everything else; any other key is some
      // other consumer's business.
      if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) {
        return;
      }
      setPreferenceState(interpretStoredPreference(event.newValue));
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 12.5, 12.7, 12.15: the Theme lands on the existing document element, in
  // place. Nothing here navigates or reloads, so the token tables switch under
  // a mounted tree and the active Destination_Content keeps its state.
  useEffect(() => {
    applyThemeAttribute(theme, themeTarget);
  }, [theme, themeTarget]);

  const value = useMemo<ShellTheme>(
    () => ({ theme, preference, setPreference }),
    [theme, preference, setPreference],
  );

  return <ShellThemeContext.Provider value={value}>{children}</ShellThemeContext.Provider>;
}

export default ShellThemeProvider;
