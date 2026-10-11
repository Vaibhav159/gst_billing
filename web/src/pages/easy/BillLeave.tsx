export type LeaveBillDialogProps = {
  open: boolean; name: string; busy: boolean; error?: string; onStay: () => void; onKeep: () => void; onThrow: () => void;
};
/** The owner of the bill handles keep/discard/Undo; closing this controlled sheet always means stay. */
export function LeaveBillDialog({ open, name, busy, error, onStay, onKeep, onThrow }: LeaveBillDialogProps) {
  return <Dialog open={open} onClose={() => { if (!busy) onStay(); }} title="Keep this bill for later?"
    description={`${possessive(name)} bill isn't saved yet.`}
    footer={<>
      <Button variant="danger-outline" size="lg" disabled={busy} onClick={onThrow}>Throw it away</Button>
      <Button variant="primary" size="xl" disabled={busy} onClick={onKeep}>Keep it as an unfinished bill</Button>
    </>}>
    <p className="text-fg2">Kept bills wait on Home with Finish, with everything you typed. Throw it away if the customer isn't buying.</p>
    {error && <p role="alert" className="text-neg mt-3">{error}</p>}
  </Dialog>;
}
import { possessive } from "@/core/format";
import { Button, Dialog } from "@/core/ui";
