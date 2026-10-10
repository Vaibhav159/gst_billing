// Selling's shared types (contract §0.2; plan 1B adds its own). PaymentMode: cash, bank (UPI / bank), credit (udhaar), mixed (part cash, part UPI), "" (not recorded).
export type PaymentMode = "cash" | "bank" | "credit" | "mixed" | "";
