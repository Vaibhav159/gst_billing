/**
 * Seed data generator — creates realistic jewellery billing data
 * across 3 financial years for 3 businesses.
 */
import type { Invoice, InvoiceItem, Business, Customer, Product } from "./mockData";

// ── Deterministic-ish random (seeded via index) ──
let _seed = 42;
function rand(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Static IDs ──
const BIZ_IDS = ["biz-lodha01", "biz-shrilod", "biz-pyarch1"];
const PROD_IDS = ["pro-gold22", "pro-goldor", "pro-silver", "pro-silsvc"];
const FY_LIST = ["2023-24", "2024-25", "2025-26"];

// ── Businesses ──
const BUSINESSES: Business[] = [
  {
    id: BIZ_IDS[0], name: "Lodha Jewellers", gst: "08AAGPL3375F1ZO", pan: "AAGPL3375F",
    state: "Rajasthan", address: "34, Moti Chohatta, Clock Tower, Udaipur - 313001",
    mobile: "9414163375", email: "",
    bankName: "State Bank of India", accountNo: "30812345678", ifsc: "SBIN0030812", branch: "Clock Tower, Udaipur",
    createdAt: "2023-04-01T00:00:00.000Z",
  },
  {
    id: BIZ_IDS[1], name: "Shri Lodha Jewellers", gst: "08AAKPL4741M1Z9", pan: "AAKPL4741M",
    state: "Rajasthan", address: "12, Bada Bazaar, Near Jagdish Temple, Udaipur - 313001",
    mobile: "9414174741", email: "shrilodha@gmail.com",
    bankName: "Bank of Baroda", accountNo: "92150100012345", ifsc: "BARB0UDAIPU", branch: "Udaipur Main",
    createdAt: "2023-04-01T00:00:00.000Z",
  },
  {
    id: BIZ_IDS[2], name: "Pyarchand Ratan Lal", gst: "08AALPL9353Q1ZQ", pan: "AALPL9353Q",
    state: "Rajasthan", address: "Shop No. 7, Ghanta Ghar, Udaipur - 313001",
    mobile: "9414199353", email: "pyarchandratanlal@gmail.com",
    bankName: "Punjab National Bank", accountNo: "0712000100567890", ifsc: "PUNB0071200", branch: "Udaipur City",
    createdAt: "2023-04-01T00:00:00.000Z",
  },
];

// ── Products ──
const PRODUCTS: Product[] = [
  { id: PROD_IDS[0], name: "Gold Ornaments 22ct", hsn: "711319", gstRate: 3, description: "Semifinished", createdAt: "2023-04-01T00:00:00.000Z" },
  { id: PROD_IDS[1], name: "Gold Ornaments", hsn: "711319", gstRate: 3, description: "", createdAt: "2023-04-01T00:00:00.000Z" },
  { id: PROD_IDS[2], name: "Silver Ornaments", hsn: "711319", gstRate: 3, description: "", createdAt: "2023-04-01T00:00:00.000Z" },
  { id: PROD_IDS[3], name: "Silver Service (Chandi Seva)", hsn: "711319", gstRate: 3, description: "", createdAt: "2023-04-01T00:00:00.000Z" },
];

// ── Customers ──
const CUSTOMER_DATA: { name: string; gst: string; pan: string; state: string; address: string; bizIds: string[] }[] = [
  { name: "Inderjeet Singh Prem Singh Sisodia", gst: "", pan: "LBHPS6473C", state: "Rajasthan", address: "Fateh Sagar Road, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Kailash Ji Lakhhara", gst: "", pan: "", state: "Rajasthan", address: "Surajpole, Udaipur", bizIds: [BIZ_IDS[0], BIZ_IDS[1]] },
  { name: "Rakesh Kumar Kishanlal", gst: "08BKEPR8141N1ZJ", pan: "BKEPR8141N", state: "Rajasthan", address: "Hiran Magri, Udaipur", bizIds: [BIZ_IDS[1]] },
  { name: "Ramchandra Soni", gst: "", pan: "", state: "Rajasthan", address: "Bhatt Ji Ki Bari, Udaipur", bizIds: [BIZ_IDS[2]] },
  { name: "Kishanlal Chogalal", gst: "", pan: "", state: "Rajasthan", address: "Bada Bazaar, Udaipur", bizIds: [BIZ_IDS[0], BIZ_IDS[2]] },
  { name: "Goverdhanlal Ji", gst: "", pan: "", state: "Rajasthan", address: "Ashok Nagar, Udaipur", bizIds: [BIZ_IDS[0], BIZ_IDS[2]] },
  { name: "Shubham Ji Soni", gst: "", pan: "", state: "Rajasthan", address: "Ambamata, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Vikas Ji Soni", gst: "", pan: "", state: "Rajasthan", address: "Chetak Circle, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Pushkar Ji Soni", gst: "", pan: "", state: "Rajasthan", address: "Delhi Gate, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Pradeep Ji Mehta", gst: "", pan: "", state: "Rajasthan", address: "Shastri Circle, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Hemant Ji", gst: "", pan: "", state: "Rajasthan", address: "Pratap Nagar, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Ramesh Ji", gst: "", pan: "", state: "Rajasthan", address: "University Road, Udaipur", bizIds: [BIZ_IDS[0]] },
  { name: "Ramlal Ji", gst: "", pan: "", state: "Rajasthan", address: "Sukhadia Circle, Udaipur", bizIds: [BIZ_IDS[1]] },
  { name: "Goverdhanlal Chaganlal", gst: "", pan: "", state: "Rajasthan", address: "Bapu Bazaar, Udaipur", bizIds: [BIZ_IDS[2]] },
  { name: "Solanki Jewellers", gst: "27AABPJ7462L1ZE", pan: "AABPJ7462L", state: "Maharashtra", address: "12/14, Dhanji Street, Office 5A, 1st Floor, Mumbai - 400003", bizIds: [BIZ_IDS[0], BIZ_IDS[1]] },
  { name: "Mahesh Ji Agrawal", gst: "", pan: "", state: "Rajasthan", address: "Sector 14, Udaipur", bizIds: [BIZ_IDS[0], BIZ_IDS[1]] },
  { name: "Suresh Kumar Jain", gst: "08AADPJ5234K1ZP", pan: "AADPJ5234K", state: "Rajasthan", address: "Bapu Bazaar, Udaipur", bizIds: [BIZ_IDS[0], BIZ_IDS[1], BIZ_IDS[2]] },
  { name: "Dinesh Verma", gst: "", pan: "BMPVD1234F", state: "Rajasthan", address: "Madhuban, Udaipur", bizIds: [BIZ_IDS[1], BIZ_IDS[2]] },
  { name: "Sanjay Ji Shrimal", gst: "", pan: "", state: "Rajasthan", address: "Town Hall, Udaipur", bizIds: [BIZ_IDS[0], BIZ_IDS[1]] },
  { name: "Rajendra Soni", gst: "", pan: "", state: "Rajasthan", address: "Chand Pole, Udaipur", bizIds: [BIZ_IDS[0]] },
];

const CUSTOMERS: Customer[] = CUSTOMER_DATA.map((c, i) => ({
  id: `cust-${String(i + 1).padStart(3, "0")}`,
  name: c.name,
  gst: c.gst,
  pan: c.pan,
  mobile: `94141${String(60000 + i * 111).slice(0, 5)}`,
  email: "",
  state: c.state,
  address: c.address,
  businessIds: c.bizIds,
  tags: [],
  createdAt: "2023-04-01T00:00:00.000Z",
}));

// ── Gold / silver rates per FY (approximate range per gram) ──
const GOLD_RATE: Record<string, [number, number]> = {
  "2023-24": [9800, 11500],
  "2024-25": [11800, 14200],
  "2025-26": [14000, 16500],
};
const SILVER_RATE: Record<string, [number, number]> = {
  "2023-24": [65, 90],
  "2024-25": [85, 120],
  "2025-26": [120, 180],
};

// ── Invoice number patterns per business ──
// Lodha: sequential (100, 101, ...)
// Shri Lodha: C-prefixed (C50, C51, ...)
// Pyarchand: 3-digit (030, 031, ...)
function getInvoiceNumber(bizIdx: number, seqNum: number): string {
  if (bizIdx === 0) return String(seqNum);
  if (bizIdx === 1) return `C${seqNum}`;
  return String(seqNum).padStart(3, "0");
}

// Invoices per month per business [min, max]
const INVOICES_PER_MONTH: [number, number][] = [
  [3, 6],  // Lodha — most active
  [1, 3],  // Shri Lodha
  [1, 3],  // Pyarchand
];

// ── Main generator ──
export function generateSeedData(): {
  businesses: Business[];
  customers: Customer[];
  products: Product[];
  invoices: Invoice[];
} {
  _seed = 42; // reset for determinism
  const invoices: Invoice[] = [];

  for (const fy of FY_LIST) {
    const fyStart = parseInt(fy.split("-")[0]);
    // Months: Apr(3)..Mar(2 next year)
    const months: { year: number; month: number }[] = [];
    for (let m = 3; m <= 11; m++) months.push({ year: fyStart, month: m }); // Apr–Dec
    for (let m = 0; m <= 2; m++) months.push({ year: fyStart + 1, month: m }); // Jan–Mar

    for (let bizIdx = 0; bizIdx < 3; bizIdx++) {
      const biz = BUSINESSES[bizIdx];
      // Starting sequence number per FY
      const baseSeq = bizIdx === 0 ? 100 : bizIdx === 1 ? 50 : 30;
      const fyOffset = FY_LIST.indexOf(fy);
      let seq = baseSeq + fyOffset * 60; // rough offset per FY

      // Get customers for this business
      const bizCusts = CUSTOMERS.filter((c) => CUSTOMER_DATA[CUSTOMERS.indexOf(c)]?.bizIds.includes(biz.id));

      for (const { year, month } of months) {
        const [minInv, maxInv] = INVOICES_PER_MONTH[bizIdx];
        const count = randInt(minInv, maxInv);

        for (let n = 0; n < count; n++) {
          const day = randInt(1, 28);
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const cust = pick(bizCusts);
          const isIGST = cust.state !== biz.state;

          // Decide product: mostly gold for Lodha/Shri Lodha, silver for Pyarchand
          const isGold = bizIdx === 2 ? rand() < 0.2 : rand() < 0.85;
          const isSilverService = !isGold && rand() < 0.15;
          const prod = isGold
            ? (rand() < 0.5 ? PRODUCTS[0] : PRODUCTS[1])
            : (isSilverService ? PRODUCTS[3] : PRODUCTS[2]);

          // Rate based on FY
          const [rLo, rHi] = isGold ? GOLD_RATE[fy] : SILVER_RATE[fy];
          const rate = round2(rLo + rand() * (rHi - rLo));

          // Quantity
          const qty = isGold
            ? round2(0.5 + rand() * 80) // 0.50 to 80 gm
            : round2(10 + rand() * 300); // 10 to 310 gm silver

          const amount = round2(qty * rate);
          const gstRate = prod.gstRate;
          const taxAmt = round2(amount * gstRate / 100);
          const cgst = isIGST ? 0 : round2(taxAmt / 2);
          const sgst = isIGST ? 0 : round2(taxAmt / 2);
          const igst = isIGST ? taxAmt : 0;

          const item: InvoiceItem = {
            productId: prod.id,
            productName: prod.name,
            hsn: prod.hsn,
            gstRate,
            qty,
            rate,
            amount,
            cgst,
            sgst,
            igst,
            unit: isGold ? "gms" : "gms",
            description: prod.description || undefined,
          };

          const subtotal = amount;
          const totalTax = cgst + sgst + igst;
          const rawTotal = subtotal + totalTax;
          const rounded = Math.round(rawTotal);
          const roundedOff = round2(rounded - rawTotal);

          const invNumber = getInvoiceNumber(bizIdx, seq);
          seq++;

          const inv: Invoice = {
            id: `inv-${fy.replace("-", "")}-${bizIdx}-${String(seq).padStart(4, "0")}`,
            invoiceNumber: invNumber,
            date: dateStr,
            customerId: cust.id,
            customerName: cust.name,
            businessId: biz.id,
            businessName: biz.name,
            type: "OUTWARD",
            isIGST,
            items: [item],
            subtotal,
            totalCGST: cgst,
            totalSGST: sgst,
            totalIGST: igst,
            totalTax,
            total: rounded,
            financialYear: fy,
            createdAt: new Date(dateStr).toISOString(),
            updatedAt: new Date(dateStr).toISOString(),
            roundedOff: roundedOff !== 0 ? roundedOff : undefined,
            jurisdictionCity: biz.state === "Rajasthan" ? "Udaipur" : undefined,
          };

          invoices.push(inv);
        }
      }

      // Add INWARD (purchase) invoices — 1-2 per month per business
      let inSeq = 1;
      for (let mIdx = 0; mIdx < 12; mIdx++) {
        const inwardPerMonth = randInt(1, 2);
        for (let n = 0; n < inwardPerMonth; n++) {
          const { year, month } = months[mIdx];
          const day = randInt(1, 28);
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

          const suppliers = bizCusts.filter((c) => c.gst);
          const supplier = suppliers.length > 0 ? pick(suppliers) : pick(bizCusts);
          const isIGST = supplier.state !== biz.state;

          // Vary between gold and silver purchases
          const isGold = rand() > 0.35;
          const [rLo, rHi] = GOLD_RATE[fy];
          const rate = isGold ? round2(rLo + rand() * (rHi - rLo)) : round2(100 + rand() * 100);
          const qty = isGold ? round2(10 + rand() * 80) : round2(100 + rand() * 500);
          const amount = round2(qty * rate);
          const taxAmt = round2(amount * 3 / 100);
          const cgst = isIGST ? 0 : round2(taxAmt / 2);
          const sgst = isIGST ? 0 : round2(taxAmt / 2);
          const igst = isIGST ? taxAmt : 0;

          const rawTotal = amount + cgst + sgst + igst;
          const rounded = Math.round(rawTotal);
          const roundedOff = round2(rounded - rawTotal);

          invoices.push({
            id: `inv-${fy.replace("-", "")}-in-${bizIdx}-${String(inSeq).padStart(3, "0")}`,
            invoiceNumber: `PUR-${bizIdx + 1}-${String(inSeq).padStart(3, "0")}`,
            date: dateStr,
            customerId: supplier.id,
            customerName: supplier.name,
            businessId: biz.id,
            businessName: biz.name,
            type: "INWARD",
            isIGST,
            items: [{
              productId: isGold ? PRODUCTS[0].id : PRODUCTS[2].id,
              productName: isGold ? "Gold (Raw/Semifinished)" : "Silver (Raw/Semifinished)",
              hsn: "711319",
              gstRate: 3,
              qty, rate, amount,
              cgst, sgst, igst,
              unit: "gms",
              description: isGold ? "Semifinished gold" : "Semifinished silver",
            }],
            subtotal: amount,
            totalCGST: cgst,
            totalSGST: sgst,
            totalIGST: igst,
            totalTax: cgst + sgst + igst,
            total: rounded,
            financialYear: fy,
            createdAt: new Date(dateStr).toISOString(),
            updatedAt: new Date(dateStr).toISOString(),
            roundedOff: roundedOff !== 0 ? roundedOff : undefined,
          });
          inSeq++;
        }
      }
    }
  }

  // ── Manually added invoice (from user spreadsheet) ──
  invoices.push({
    id: "inv-manual-lodha-100",
    invoiceNumber: "100",
    date: "2026-02-06",
    customerId: "cust-001",
    customerName: "Inderjeet Singh Prem Singh Sisodia",
    businessId: "biz-lodha01",
    businessName: "Lodha Jewellers",
    type: "OUTWARD",
    isIGST: false,
    items: [{
      productId: "pro-gold22",
      productName: "Gold Ornaments 22ct",
      hsn: "711319",
      gstRate: 3,
      qty: 37.74,
      rate: 16397,
      amount: 618822.78,
      cgst: 9282.34,
      sgst: 9282.34,
      igst: 0,
      unit: "gms",
    }],
    subtotal: 618822.78,
    totalCGST: 9282.34,
    totalSGST: 9282.34,
    totalIGST: 0,
    totalTax: 18564.68,
    total: 637387,
    financialYear: "2025-26",
    createdAt: "2026-02-06T00:00:00.000Z",
    updatedAt: "2026-02-06T00:00:00.000Z",
    roundedOff: -0.46,
    jurisdictionCity: "Udaipur",
  });

  // Sort invoices by date
  invoices.sort((a, b) => a.date.localeCompare(b.date));

  return {
    businesses: BUSINESSES,
    customers: CUSTOMERS,
    products: PRODUCTS,
    invoices,
  };
}

/** Write seed data into localStorage (replaces existing data). */
export function loadSeedData(): { invoiceCount: number; customerCount: number } {
  const data = generateSeedData();
  localStorage.setItem("gst_data_businesses", JSON.stringify(data.businesses));
  localStorage.setItem("gst_data_customers", JSON.stringify(data.customers));
  localStorage.setItem("gst_data_products", JSON.stringify(data.products));
  localStorage.setItem("gst_data_invoices", JSON.stringify(data.invoices));

  // Dispatch event so hooks pick up changes
  window.dispatchEvent(new CustomEvent("datastore-update"));

  return { invoiceCount: data.invoices.length, customerCount: data.customers.length };
}
