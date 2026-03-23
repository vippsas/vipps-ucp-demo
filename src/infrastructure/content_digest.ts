/**
 * RFC 9530 Content-Digest for webhook bodies (Structured Fields dictionary).
 *
 * @module
 */

import {
  binary,
  item,
  serializeDictionary,
} from "@std/http/unstable-structured-fields";

/** Build `Content-Digest` for the exact bytes sent as the request body. */
export async function createContentDigestHeader(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return serializeDictionary(new Map([["sha-256", item(binary(hash))]]));
}
