// Office 365 Users profile-photo lookups for engineer avatars.
//
// Everything here is best-effort and non-blocking: the board renders initials
// immediately and a photo simply replaces them if/when one resolves. Results
// (including misses) are cached in memory for the life of the page; photos and
// profiles are never written to browser storage.
//
// Nothing is fabricated: only a real photo returned by the connector for the
// exact identity taken from the work item's "Assigned To" field is shown.

import { useEffect, useState } from "react";
import { connectors } from "@/connectors";

// identity (lower-cased) -> data URL, or null when there is no usable photo.
const photoCache = new Map<string, string | null>();
// identity -> in-flight request, so concurrent avatars share one lookup.
const inFlight = new Map<string, Promise<string | null>>();

// The connector returns photo content as a base64 payload (occasionally already
// a data URL). Anything else is rejected rather than piped into an <img>.
export function toPhotoDataUrl(raw: unknown, contentType?: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const type = contentType && /^image\/(png|jpe?g|gif|webp)$/.test(contentType) ? contentType : "image/jpeg";
  return `data:${type};base64,${compact}`;
}

async function loadPhoto(identity: string): Promise<string | null> {
  try {
    const users = connectors().office365Users;
    // Metadata first: it cheaply tells us whether a photo exists at all (and
    // its content type), so users without one never trigger a photo download.
    const meta = await users.photoMetadata(identity);
    if (meta.success && meta.data?.HasPhoto === false) return null;
    const contentType = meta.success ? meta.data?.ContentType : undefined;

    const photo = await users.photo(identity);
    if (!photo.success) return null;
    return toPhotoDataUrl(photo.data, contentType);
  } catch {
    return null; // person not found / no access / connector error -> initials
  }
}

/** Resolve one identity's photo, deduped and cached (including misses). */
export function getPersonPhoto(identity: string): Promise<string | null> {
  const key = identity.trim().toLowerCase();
  if (!key || !key.includes("@")) return Promise.resolve(null);
  if (photoCache.has(key)) return Promise.resolve(photoCache.get(key) ?? null);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = loadPhoto(key)
    .catch(() => null)
    .then((url) => {
      photoCache.set(key, url);
      inFlight.delete(key);
      return url;
    });
  inFlight.set(key, request);
  return request;
}

function identitySignature(identities: string[]): string {
  return Array.from(
    new Set(identities.map((i) => i.trim().toLowerCase()).filter(Boolean)),
  )
    .sort()
    .join("|");
}

/**
 * Look up photos for a set of identities in the background.
 *
 * Returns identity (lower-cased) -> data URL for the identities that resolved
 * to a photo; everyone else keeps their initials. Lookups run at a small
 * concurrency limit so a big roster never floods the connector.
 */
export function usePersonPhotos(identities: string[]): Record<string, string> {
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const signature = identitySignature(identities);

  useEffect(() => {
    const keys = signature ? signature.split("|") : [];
    if (keys.length === 0) return;
    let cancelled = false;

    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < keys.length) {
        const key = keys[cursor++];
        const url = await getPersonPhoto(key);
        if (cancelled || !url) continue;
        setPhotos((prev) => (prev[key] === url ? prev : { ...prev, [key]: url }));
      }
    };
    void Promise.all(
      Array.from({ length: Math.min(4, keys.length) }, worker),
    ).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [signature]);

  return photos;
}
