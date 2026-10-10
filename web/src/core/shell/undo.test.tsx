import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosAdapter } from "axios";
import { api } from "@/core/api/client";
import { ScopeProvider } from "@/core/scope";
import { useToast } from "@/core/ui";
import { renderApp } from "@/test/render";
import { DesktopShell } from "./DesktopShell";

beforeEach(() => {
  localStorage.clear();
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("businesses/") ? { results: [] } : { data: {} } })) as AxiosAdapter;
});
afterEach(() => { vi.useRealTimers(); });

function Deleter({ undo }: { undo: () => void }) {
  const { show } = useToast();
  return <button type="button" onClick={() => show({ title: "Deleted KGH/2026-27/31", body: "It's in the Audit log, where it can be restored.", action: { label: "Undo", onClick: undo } })}>delete it</button>;
}
const shell = (undo: () => void) => renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><Deleter undo={undo} /><input aria-label="Note" /></DesktopShell></ScopeProvider>, { path: "/sales" });

test("Ctrl Z runs the last Undo a toast offered, once; then there's nothing to undo", async () => {
  const undo = vi.fn();
  shell(undo);
  await userEvent.click(screen.getByText("delete it"));
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(undo).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(undo).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Nothing to undo")).toBeInTheDocument();
  expect(screen.getByText("Ctrl Z undoes a delete, a discard or a removed line for 30 seconds after it.")).toBeInTheDocument();
});

test("an Undo older than 30 seconds is gone", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const undo = vi.fn();
  shell(undo);
  await userEvent.click(screen.getByText("delete it"));
  act(() => { vi.advanceTimersByTime(30_001); });
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(undo).not.toHaveBeenCalled();
  expect(await screen.findByText("Nothing to undo")).toBeInTheDocument();
});

test("pressing the toast's own Undo uses it up: Ctrl Z doesn't run it a second time", async () => {
  const undo = vi.fn();
  shell(undo);
  await userEvent.click(screen.getByText("delete it"));
  await userEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  expect(undo).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(undo).toHaveBeenCalledTimes(1);
});

test("Ctrl Z in a field is the field's own undo", async () => {
  const undo = vi.fn();
  shell(undo);
  await userEvent.click(screen.getByText("delete it"));
  await userEvent.click(screen.getByLabelText("Note"));
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(undo).not.toHaveBeenCalled();
});
