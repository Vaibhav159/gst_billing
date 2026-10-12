/** Compare a server sign-in session across token rotations; legacy tokens fall back to exact equality. */
export function sameTokenSession(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  try {
    const claims = (value: string) => JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {sid?:string;user_id?:number};
    const a = claims(left), b = claims(right);
    if (a.sid && b.sid) return a.sid === b.sid && a.user_id === b.user_id;
  } catch { /* legacy or opaque test token */ }
  return left === right;
}
