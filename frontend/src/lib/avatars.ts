// Profile pictures: every image in src/assets/avatars/ is an option on the Account page — to add one,
// drop a square .webp (about 384 × 384, head only) in that folder. Nothing is uploaded by users.
// Only .webp files count, so full-size originals (.png / .jpg) left in the folder are ignored.
// An account stores the picture's file name without its extension, e.g. "avatar-01".
const files = import.meta.glob<string>("/src/assets/avatars/*.webp", { eager: true, query: "?url", import: "default" });

export const AVATARS = Object.entries(files)
  .map(([path, url]) => ({ id: path.split("/").pop()!.replace(/\.[^.]+$/, ""), url }))
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

/** The picture for a saved choice, or null (none picked, or the file was removed): show initials. */
export const avatarUrl = (id: string | null | undefined) => AVATARS.find((a) => a.id === id)?.url ?? null;

/** Initials of the display name, else the start of the email. */
export const initialsOf = (user: { name: string | null; email: string }) =>
  (user.name?.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || user.email.replace(/[^a-z0-9]/gi, "").slice(0, 2)).toUpperCase();
