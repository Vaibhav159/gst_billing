// The ₹ in the app's react-pdf documents (the bill, 1C's customer statement). The PDF's built-in Times and Helvetica are
// WinAnsi-encoded and have no ₹ (it would print as "¹"): the one-glyph Tinos font carries it, registered here once for
// every document (Ruling 1E-6), and RupeeText sets each ₹ of a text in it (Ruling 1E-5). A document imports this
// module, so it loads with react-pdf, never in the app's first download.
import { Font, Text, type Styles } from "@react-pdf/renderer";
import rupeeSignFont from "./rupeeSignFont";

// ponytail: only the ₹ has a font of its own, so Devanagari (a name typed in Hindi) and emoji print garbled, as in v2's
// invoice. Upgrade: Noto Sans Devanagari as a fallback family, about 187 kB, in the PDF's on-demand chunk only.
export const RUPEE_FONT = "RupeeSign";
Font.register({ family: RUPEE_FONT, src: rupeeSignFont });

type Style = Styles[string];
const SIGN: Style = { fontFamily: RUPEE_FONT };

/**
 * Text that can hold a ₹: anything someone typed (a name, an address, a note, a box, the bank's details) and the Total.
 * Each ₹ is a text of its own in the RupeeSign font, inside the text around it, which keeps its style. The paper on
 * screen (Paper.tsx) draws the same strings through its twin of this piece.
 */
export function RupeeText({ children, style }: { children: string; style?: Style | Style[] }) {
  const parts = children.split("₹");
  if (parts.length === 1) return <Text style={style}>{children}</Text>;
  return <Text style={style}>{parts.flatMap((part, i) => [...(i ? [<Text key={i} style={SIGN}>₹</Text>] : []), ...(part ? [part] : [])])}</Text>;
}
