import { pdfCodeMissing } from "./files";

export const ATTACH_PDF = "Attach it to an email, or put it on Drive, from your Downloads folder.";

/** A PDF needs the shop's choices and a bill that still exists. */
export class Unmade extends Error {
  constructor(readonly lack: "settings" | "bill") { super(lack === "settings" ? "The shop's settings didn't load." : "This bill was deleted."); }
}

/** Shared by Print, Send and Share. Missing PDF code needs a reload; asking again cannot bring it back. */
export function unmade(error: unknown, offline: boolean, what: string): { why: string; todo: string; body: string; again: boolean } {
  let why: string;
  let todo: string;
  let again = true;
  if (error instanceof Unmade && error.lack === "bill") {
    why = "This bill was deleted.";
    todo = "";
    again = false;
  } else if (pdfCodeMissing(error)) {
    why = offline ? "You're offline, and the part of the app that makes PDFs didn't load." : "The part of the app that makes PDFs didn't load.";
    todo = offline ? "Reload the page once the internet is back." : "Reload the page, then try again.";
    again = false;
  } else if (offline) {
    why = `You're offline, so the ${what} wasn't made.`;
    todo = "It needs the internet; try again when you're back.";
  } else if (error instanceof Unmade) {
    why = "The shop's settings didn't load, and the PDF needs them.";
    todo = "Try again in a minute.";
  } else {
    why = "Something stopped it part way.";
    todo = "Try again.";
  }
  return { why, todo, body: [why, todo].filter(Boolean).join(" "), again };
}
