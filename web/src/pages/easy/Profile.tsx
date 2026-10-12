import { useState } from "react";
import { useProfile } from "@/core/api/account";
import { useAuth } from "@/core/auth/AuthProvider";
import { QueryView } from "@/core/ui";
import { EasyPage } from "./parts";
import { useEasyFirm } from "./state";
import { ProfileBody } from "./ProfileBody";
import { EasyPasswordForm } from "./PasswordForm";

export default function Profile() {
  const profile = useProfile();
  const { firm } = useEasyFirm();
  const { me, signOut } = useAuth();
  const [dirty, setDirty] = useState(false);
  return <EasyPage back title="Profile and password" subtitle={`@${me?.username || ""}`} docTitle="Profile and password">
    <QueryView query={profile} what="your profile">{(person) => <ProfileBody key={person.id} person={person} firm={firm} dirty={dirty} signOut={signOut}
      passwordForm={<EasyPasswordForm person={person} onDirty={setDirty} />} />}</QueryView>
  </EasyPage>;
}
