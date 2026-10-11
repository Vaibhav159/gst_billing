import { BarChart3, Gem, Hash, History, Landmark, ReceiptText, ShoppingBag, Users } from 'lucide-react';
export const GST_PAGES = [
  { label:'Credit and deadlines', to:'/gst?tab=credit', icon:Landmark },
  { label:'Reconciliation', to:'/gst?tab=recon', icon:History },
  { label:'Sales register', to:'/reports/sales', icon:ReceiptText },
  { label:'Tax summary', to:'/reports/tax', icon:Landmark },
  { label:'HSN summary', to:'/reports/hsn', icon:Hash },
  { label:'Month by month', to:'/reports/months', icon:BarChart3 },
  { label:'Purchase register', to:'/reports/purchases', icon:ShoppingBag },
  { label:'Top customers', to:'/reports/customers', icon:Users },
  { label:'Top products', to:'/reports/products', icon:Gem },
] as const;
