import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/core/auth/role";
import { api } from "./client";
import { usePrivateMutation, type Detail } from "./auth";

export type Person = { id: number; username: string; first_name: string; last_name: string; name: string; email: string; role: Role; role_label: string; placed: boolean; needs_role_choice: boolean; active: boolean; stopped_at: string | null; stopped_by: {id:number;name:string} | null; usual_firm: {id:number;name:string;short:string} | null; last_active: string | null; joined: string; must_change_password: boolean; you: boolean };
export type PersonInput = Pick<Person, "first_name" | "last_name" | "username" | "email" | "role"> & { usual_firm: number | null; password: string };
export type PersonChange = { id:number; action:"role"; body:{role:Role} } | { id:number; action:"usual-firm"; body:{business:number|null} } | { id:number; action:"stop"|"allow"; body?:never };
export type PersonHistoryEntry = { id:number; at:string; by:{id:number;name:string}|null; action:string; entity:string; words:{text:string;target:string;after:string}; link:string|null; details:string; changes:{key:string;field:string;from:string;to:string}[] };
export function usePeople(enabled = true) { return useQuery({ queryKey:["people"], enabled, queryFn:async ({signal}) => (await api.get<{results:Person[]}>("people/",{signal})).data }); }
function useRefreshPeople() { const qc = useQueryClient(); return async () => { await Promise.all(["people","audit","setup"].map(key => qc.invalidateQueries({queryKey:[key]}))); }; }
export function useAddPerson() { const refresh = useRefreshPeople(); return usePrivateMutation(async (input:PersonInput) => (await api.post<Person>("people/",input)).data,refresh); }
export function useChangePerson() { const refresh = useRefreshPeople(); return useMutation({mutationFn:async ({id,action,body}:PersonChange) => (await api.post<Person>(`people/${id}/${action}/`,body)).data,onSuccess:refresh}); }
export function useSetPersonPassword() { const refresh = useRefreshPeople(); return usePrivateMutation(async ({id,password}:{id:number;password:string}) => (await api.post<Detail>(`people/${id}/password/`,{password})).data,refresh); }
export function usePersonHistory(id?:number, enabled = true) { return useQuery({queryKey:["audit","people",id ?? "all"],enabled,queryFn:async ({signal}) => (await api.get<{results:PersonHistoryEntry[]}>("audit/",{params:{entity:"user",...(id === undefined ? {} : {entity_id:id}),page_size:5},signal})).data}); }
