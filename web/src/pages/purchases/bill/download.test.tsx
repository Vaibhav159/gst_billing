import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import type { AxiosAdapter } from "axios";
import { api } from "@/core/api/client";
import { saveFile } from "@/core/print/files";
import { salesServer } from "@/core/sales/fixtures";
import { purchaseDetailWire } from "@/core/purchases/fixtures";
import { renderApp } from "@/test/render";
import PurchasePage from "../PurchasePage";

vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));

test("Download original fetches the signed file at its own /api/media/ address", async () => {
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire()], ["GET", "media/original?s=synthetic", () => new Blob(["original"])]]);
  const inner = api.defaults.adapter as AxiosAdapter, uris: string[] = [];
  api.defaults.adapter = (config) => { uris.push(api.getUri(config)); return inner(config); };
  renderApp(<Routes><Route path="/purchases/:id" element={<PurchasePage />} /></Routes>, { path: "/purchases/905" });
  await userEvent.click((await screen.findAllByRole("button", { name: "Download original" }))[0]);
  await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), "synthetic.jpg"));
  expect(uris.filter((u) => u.includes("media"))).toEqual(["/api/media/original?s=synthetic"]);
});
