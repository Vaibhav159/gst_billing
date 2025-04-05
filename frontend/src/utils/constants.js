// State choices for India
export const STATE_CHOICES = [
  { value: "JAMMU AND KASHMIR", label: "Jammu and Kashmir" },
  { value: "HIMACHAL PRADESH", label: "Himachal Pradesh" },
  { value: "PUNJAB", label: "Punjab" },
  { value: "CHANDIGARH", label: "Chandigarh" },
  { value: "UTTARAKHAND", label: "Uttarakhand" },
  { value: "HARYANA", label: "Haryana" },
  { value: "DELHI", label: "Delhi" },
  { value: "RAJASTHAN", label: "Rajasthan" },
  { value: "UTTAR PRADESH", label: "Uttar Pradesh" },
  { value: "BIHAR", label: "Bihar" },
  { value: "SIKKIM", label: "Sikkim" },
  { value: "ARUNACHAL PRADESH", label: "Arunachal Pradesh" },
  { value: "NAGALAND", label: "Nagaland" },
  { value: "MANIPUR", label: "Manipur" },
  { value: "MIZORAM", label: "Mizoram" },
  { value: "TRIPURA", label: "Tripura" },
  { value: "MEGHALAYA", label: "Meghalaya" },
  { value: "ASSAM", label: "Assam" },
  { value: "WEST BENGAL", label: "West Bengal" },
  { value: "JHARKHAND", label: "Jharkhand" },
  { value: "ODISHA", label: "Odisha" },
  { value: "CHHATTISGARH", label: "Chhattisgarh" },
  { value: "MADHYA PRADESH", label: "Madhya Pradesh" },
  { value: "GUJARAT", label: "Gujarat" },
  { value: "DAMAN AND DIU", label: "Daman and Diu" },
  { value: "DADRA AND NAGAR HAVELI", label: "Dadra and Nagar Haveli" },
  { value: "MAHARASHTRA", label: "Maharashtra" },
  { value: "KARNATAKA", label: "Karnataka" },
  { value: "GOA", label: "Goa" },
  { value: "LAKSHADWEEP", label: "Lakshadweep" },
  { value: "KERALA", label: "Kerala" },
  { value: "TAMIL NADU", label: "Tamil Nadu" },
  { value: "PUDUCHERRY", label: "Puducherry" },
  { value: "ANDAMAN AND NICOBAR ISLANDS", label: "Andaman and Nicobar Islands" },
  { value: "TELANGANA", label: "Telangana" },
  { value: "ANDHRA PRADESH", label: "Andhra Pradesh" },
  { value: "LADAKH", label: "Ladakh" },
  { value: "OTHER TERRITORY", label: "Other Territory" },
  { value: "CENTRE JURISDICTION", label: "Centre Jurisdiction" },
];

// Function to search states
export const searchStates = (query) => {
  if (!query) return STATE_CHOICES;
  
  const lowerQuery = query.toLowerCase();
  return STATE_CHOICES.filter(state => 
    state.label.toLowerCase().includes(lowerQuery)
  );
};
