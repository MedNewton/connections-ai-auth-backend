// src/lib/userKey.ts
//
// IMPORTANT: This logic MUST stay bit-identical to the client-side
// `userKeyFromUser` in `connections-ai/src/lib/sessionStore.ts`.
// If you change one, change the other in the same commit.
const FORBIDDEN_RTDB_CHAR_CODES = new Set([
    46, // .
    35, // #
    36, // $
    91, // [
    93, // ]
    47, // /
]);
function isValidRtdbKeyCharCode(cc) {
    return !FORBIDDEN_RTDB_CHAR_CODES.has(cc);
}
function sanitizeRtdbKey(raw) {
    const s = raw.trim();
    let out = "";
    for (let i = 0; i < s.length; i += 1) {
        const cc = s.charCodeAt(i);
        out += isValidRtdbKeyCharCode(cc) ? s[i] : "_";
    }
    return out || "user";
}
export function userKeyFromUser(user) {
    const id = typeof user.id === "string" ? user.id.trim() : "";
    if (id)
        return `u_${sanitizeRtdbKey(id)}`;
    const email = typeof user.email === "string" ? user.email.trim() : "";
    if (email)
        return `e_${sanitizeRtdbKey(email.toLowerCase())}`;
    throw new Error("User has no id/email; cannot derive user key.");
}
