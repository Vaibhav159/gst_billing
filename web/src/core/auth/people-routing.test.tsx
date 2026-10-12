import { act, screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import More from "@/pages/core/More";
import { appRoutes } from "@/core/router/routes";
import { AuthContext } from "./AuthProvider";
import { stubAuth } from "@/test/render";
import { AccountMenu } from "@/core/shell/AccountMenu";
import { MemoryRouter } from "react-router";
import { render } from "@testing-library/react";
import { ToastProvider } from "@/core/ui";

const setup={firms:{count:3,names:[]},customers:{count:28,names:[]},products:{count:17,names:[]},bills:{count:332,cancelled:2},people:4,last_backup_at:"2026-10-01T21:05:00+05:30"};
test("More gets live products, people and the last backup from one setup request",async()=>{
  const calls=serve({"GET setup/":setup,"GET preferences/":{data:{}}}); renderApp(<More/>);
  expect(await screen.findByText("17 products with HSN and GST rate")).toBeInTheDocument();
  expect(screen.getByText("4 people can sign in")).toBeInTheDocument(); expect(screen.getByText(/Last full backup/)).toHaveTextContent("01 Oct 2026");
  expect(calls.filter(c=>c.url==="setup/")).toHaveLength(1);
});
test("More does not invent zero counts while setup fails",async()=>{
  serve({"GET setup/":()=>({status:500}),"GET preferences/":{data:{}}}); renderApp(<More/>);
  await screen.findByText("Counts couldn't load. Try again."); expect(screen.queryByText(/0 products/)).not.toBeInTheDocument();
});
test("own people and profile routes replace only their placeholders and password sits outside AppLayout",()=>{
  const root=appRoutes[0].children!; expect(root.some(route=>route.path==="/password")).toBe(true);
  const authed=root.find(route=>route.children?.some(child=>child.path==="/users"))!;
  expect(authed.children!.filter(route=>route.path==="/users")).toHaveLength(1); expect(authed.children!.filter(route=>route.path==="/profile")).toHaveLength(1);
});
test("a failed menu signout says it failed and offers retry without closing the question",async()=>{
  const auth=stubAuth(); auth.signOut=vi.fn().mockRejectedValue(new Error("offline"));
  render(<AuthContext.Provider value={auth}><MemoryRouter><ToastProvider><AccountMenu onShortcuts={()=>{}}/></ToastProvider></MemoryRouter></AuthContext.Provider>);
  act(()=>screen.getByRole("button",{name:/Account:/}).click()); act(()=>screen.getByRole("menuitem",{name:"Sign out"}).click());
  await screen.findByRole("dialog"); const now=Date.now(); vi.spyOn(Date,"now").mockReturnValue(now+1000); await act(async()=>screen.getByRole("button",{name:/^Sign out$/}).click());
  await waitFor(()=>expect(auth.signOut).toHaveBeenCalledTimes(1)); expect(await screen.findByText("Sign out didn't finish. Try again when the app can connect.")).toBeInTheDocument();
});

afterEach(()=>vi.restoreAllMocks());
