/**
 * Unit tests for the Notifications_Api facade's request shapes (task 7.4).
 *
 * These drive `createNotificationsApi` over the **real** generated
 * `@pitchmate/api-client` instance with an injected `fetch`, so the assertions
 * are made against the URL, method, and body that actually leave the client
 * rather than against a hand-rolled stand-in for it. Four things are covered:
 *
 * - `markRead` supplies the Notification_Record's identity and nothing else —
 *   no squad identity in the path, the query string, or the body, whether or not
 *   a Squad_Scope is active (Requirement 7.5).
 * - a `204 No Content` from the mark-read endpoint settles as success carrying
 *   no parsed value, so an empty successful response is never mistaken for an
 *   uninterpretable one (Requirement 11.7).
 * - the scoped calls (list, unread-count, mark-all-read) carry `squadId` as a
 *   query parameter when a Squad_Scope is active and carry no query parameter at
 *   all when none is, with every path and query key taken from the generated
 *   contract's own types (Requirement 11.2).
 * - a response body the pure parsers reject settles the call as `failure`
 *   (Requirements 10.9, 10.10).
 *
 * Requirements: 7.5, 10.9, 10.10, 11.2, 11.7
 */

import { createApiClient, type operations, type paths } from '@pitchmate/api-client';
import { describe, expect, it } from 'vitest';

import { createNotificationsApi } from './notificationsApi';

// --- Contract-derived literals (Requirement 11.2) ---------------------------
//
// Typing these against the generated `paths` and `operations` means the test's
// own expectations cannot drift from the contract: a renamed path or query
// parameter fails to compile here rather than passing against a stale string.

const LIST_PATH: keyof paths = '/notifications';
const UNREAD_COUNT_PATH: keyof paths = '/notifications/unread-count';
const MARK_ALL_READ_PATH: keyof paths = '/notifications/read-all';
const MARK_READ_PATH_TEMPLATE: keyof paths = '/notifications/{notificationId}/read';

type ListQuery = NonNullable<operations['ListNotifications']['parameters']['query']>;

/** The one query parameter the scoped notification calls carry. */
const SQUAD_QUERY_KEY = 'squadId' satisfies keyof ListQuery;

// --- Transport fake ---------------------------------------------------------

const BASE_URL = 'https://api.test';

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const NOTIFICATION_ID = 'a1b2c3d4-e5f6-4718-8a9b-0c1d2e3f4a5b';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly bodyText: string;
}

/** A fake `fetch` that records outgoing requests and replies from a handler. */
function makeApi(reply: (request: RecordedRequest) => Response) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: Request): Promise<Response> => {
    const recorded: RecordedRequest = {
      url: input.url,
      method: input.method,
      bodyText: await input.clone().text(),
    };
    requests.push(recorded);
    return reply(recorded);
  }) as unknown as typeof fetch;

  const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  return { api: createNotificationsApi(client), requests };
}

/** A `200 OK` carrying `body` as JSON text — what every valued call reads. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `200 OK` carrying raw text, for the unschematised-body cases. */
function textResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The `204 No Content` the mark-read endpoint answers with (Req 11.7). */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** One well-formed wire record, in the form the pure parser accepts. */
function wireRecord() {
  return {
    notificationId: NOTIFICATION_ID,
    type: 0,
    squadId: SQUAD_ID,
    title: 'Dave joined the squad',
    body: 'Dave is now a member of Thursday Nights.',
    createdAt: '2025-01-01T00:00:00Z',
    readState: 0,
  };
}

/** The single recorded request, failing the test if there was not exactly one. */
function onlyRequest(requests: RecordedRequest[]): RecordedRequest {
  expect(requests).toHaveLength(1);
  return requests[0] as RecordedRequest;
}

/** The path of a recorded request, base URL stripped. */
function pathOf(request: RecordedRequest): string {
  return new URL(request.url).pathname;
}

/** The query string of a recorded request, `?` included, or `''` if none. */
function searchOf(request: RecordedRequest): string {
  return new URL(request.url).search;
}

// --- markRead: the identity alone (Requirement 7.5) ------------------------

describe('createNotificationsApi — markRead request shape', () => {
  it('supplies the notification identity in the path and no squad identity anywhere', async () => {
    const { api, requests } = makeApi(() => noContent());

    await api.markRead({ notificationId: NOTIFICATION_ID });

    const request = onlyRequest(requests);
    expect(request.method).toBe('POST');
    expect(pathOf(request)).toBe(
      MARK_READ_PATH_TEMPLATE.replace('{notificationId}', NOTIFICATION_ID),
    );
    // 7.5: no query parameter, no body — so no squad identity can ride along,
    // irrespective of the active Squad_Scope.
    expect(searchOf(request)).toBe('');
    expect(request.bodyText).toBe('');
    expect(request.url).not.toContain(SQUAD_QUERY_KEY);
    expect(request.url).not.toContain(SQUAD_ID);
  });

  it('sends the same request while a Squad_Scope is active on the scoped calls', async () => {
    const { api, requests } = makeApi((request) =>
      request.method === 'POST' ? noContent() : jsonResponse(3),
    );

    // A scoped call first, so any scope the facade could have retained would
    // show up on the mark-read request that follows it.
    await api.unreadCount({ squadId: SQUAD_ID });
    await api.markRead({ notificationId: NOTIFICATION_ID });

    expect(requests).toHaveLength(2);
    const markRead = requests[1] as RecordedRequest;
    expect(searchOf(markRead)).toBe('');
    expect(markRead.url).not.toContain(SQUAD_ID);
  });

  // 11.7: `204 No Content` is success with no parsed value.
  it('settles a 204 No Content as success carrying no value', async () => {
    const { api } = makeApi(() => noContent());

    const outcome = await api.markRead({ notificationId: NOTIFICATION_ID });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.value).toBeUndefined();
    }
  });
});

// --- Scoped calls: query parameters (Requirement 11.2) --------------------

describe('createNotificationsApi — scoped call query parameters', () => {
  it('supplies squadId as a query parameter on the list call', async () => {
    const { api, requests } = makeApi(() => jsonResponse([wireRecord()]));

    const outcome = await api.list({ squadId: SQUAD_ID });

    expect(outcome.kind).toBe('success');
    const request = onlyRequest(requests);
    expect(request.method).toBe('GET');
    expect(pathOf(request)).toBe(LIST_PATH);
    expect(searchOf(request)).toBe(`?${SQUAD_QUERY_KEY}=${SQUAD_ID}`);
  });

  it('supplies squadId as a query parameter on the unread-count call', async () => {
    const { api, requests } = makeApi(() => jsonResponse(7));

    const outcome = await api.unreadCount({ squadId: SQUAD_ID });

    expect(outcome).toEqual({ kind: 'success', value: 7 });
    const request = onlyRequest(requests);
    expect(request.method).toBe('GET');
    expect(pathOf(request)).toBe(UNREAD_COUNT_PATH);
    expect(searchOf(request)).toBe(`?${SQUAD_QUERY_KEY}=${SQUAD_ID}`);
  });

  it('supplies squadId as a query parameter on the mark-all-read call', async () => {
    const { api, requests } = makeApi(() => jsonResponse(0));

    const outcome = await api.markAllRead({ squadId: SQUAD_ID });

    expect(outcome).toEqual({ kind: 'success', value: 0 });
    const request = onlyRequest(requests);
    expect(request.method).toBe('POST');
    expect(pathOf(request)).toBe(MARK_ALL_READ_PATH);
    expect(searchOf(request)).toBe(`?${SQUAD_QUERY_KEY}=${SQUAD_ID}`);
  });

  it('omits the query parameter entirely when no Squad_Scope is active', async () => {
    const { api, requests } = makeApi((request) =>
      request.method === 'GET' && pathOf(request) === LIST_PATH
        ? jsonResponse([])
        : jsonResponse(0),
    );

    await api.list();
    await api.unreadCount();
    await api.markAllRead();

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      // 7.1: the account-wide call is requested by omission, not by a sentinel.
      expect(searchOf(request)).toBe('');
      expect(request.url).not.toContain(SQUAD_QUERY_KEY);
    }
  });
});

// --- Parse failures settle as failure (Requirements 10.9, 10.10) ----------

describe('createNotificationsApi — a rejected body settles the call as failure', () => {
  it('settles a non-array list body as failure', async () => {
    const { api } = makeApi(() => jsonResponse({ records: [wireRecord()] }));

    expect(await api.list()).toEqual({ kind: 'failure' });
  });

  it('settles an uninterpretable list body as failure', async () => {
    const { api } = makeApi(() => textResponse('not json at all'));

    expect(await api.list()).toEqual({ kind: 'failure' });
  });

  it('keeps an array body a success even when every element is invalid', async () => {
    // 10.10 draws the parse-failure line at the top-level shape only: an array
    // of rubbish is a parsed empty list, not a failed call.
    const { api } = makeApi(() => jsonResponse([null, 42, { title: '' }]));

    expect(await api.list()).toEqual({ kind: 'success', value: [] });
  });

  it('settles a string-encoded count as failure', async () => {
    const { api } = makeApi(() => jsonResponse('7'));

    expect(await api.unreadCount()).toEqual({ kind: 'failure' });
  });

  it('settles a negative count as failure', async () => {
    const { api } = makeApi(() => jsonResponse(-1));

    expect(await api.unreadCount()).toEqual({ kind: 'failure' });
  });

  it('settles a fractional mark-all-read count as failure', async () => {
    const { api } = makeApi(() => jsonResponse(2.5));

    expect(await api.markAllRead()).toEqual({ kind: 'failure' });
  });

  it('settles an absent count body as failure', async () => {
    const { api } = makeApi(() => textResponse(''));

    expect(await api.unreadCount()).toEqual({ kind: 'failure' });
  });
});
