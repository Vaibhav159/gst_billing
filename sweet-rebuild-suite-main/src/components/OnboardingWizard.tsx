import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Users, Package, FileText, ArrowRight, ArrowLeft, X, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "@/utils/utils";

const ONBOARDING_KEY = "gst_onboarding_dismissed";

const steps = [
  { title: "Add Your Business", desc: "Register your business with GST details to start invoicing", icon: Building2, href: "/billing/business/new", color: "text-chart-1", bg: "bg-chart-1/10" },
  { title: "Add a Customer", desc: "Add your first customer to create invoices for them", icon: Users, href: "/billing/customer/new", color: "text-primary", bg: "bg-primary/10" },
  { title: "Add Products", desc: "Set up your product catalog with HSN codes and GST rates", icon: Package, href: "/billing/product/new", color: "text-chart-3", bg: "bg-chart-3/10" },
  { title: "Create an Invoice", desc: "Generate your first GST-compliant invoice", icon: FileText, href: "/billing/invoice/add", color: "text-success", bg: "bg-success/10" },
];

interface OnboardingWizardProps {
  onDismiss: () => void;
  businessCount?: number;
  productCount?: number;
  customerCount?: number;
  invoiceCount?: number;
}

export default function OnboardingWizard({ onDismiss, businessCount = 0, productCount = 0, customerCount = 0, invoiceCount = 0 }: OnboardingWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const current = steps[step];
  const Icon = current.icon;
  const stepCompleted = [businessCount > 0, customerCount > 0, productCount > 0, invoiceCount > 0];

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    onDismiss();
  };

  const goToStep = () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    navigate(current.href);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      className="elevated-card rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-[14px] font-display font-bold text-foreground">Welcome! Let's get started</h2>
            <p className="text-[11px] text-muted-foreground">Step {step + 1} of {steps.length}</p>
          </div>
        </div>
        <button onClick={dismiss} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress */}
      <div className="flex gap-1.5 px-6 pt-4">
        {steps.map((_, i) => (
          <div key={i} className={cn(
            "h-1 flex-1 rounded-full transition-all",
            stepCompleted[i] || i === step ? "bg-primary" : "bg-secondary/40"
          )} />
        ))}
      </div>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="px-6 py-6"
        >
          <div className="flex items-start gap-4">
            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0", current.bg)}>
              <Icon className={cn("w-7 h-7", current.color)} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-display font-bold text-foreground">{current.title}</h3>
              <p className="text-[13px] text-muted-foreground mt-1">{current.desc}</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Mini step indicators */}
      <div className="px-6 pb-4 flex gap-3">
        {steps.map((s, i) => {
          const StepIcon = s.icon;
          return (
            <button key={i} onClick={() => setStep(i)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                i === step ? "bg-primary/15 text-primary" :
                stepCompleted[i] ? "text-success bg-success/8" :
                "text-muted-foreground bg-secondary/20"
              )}>
              {stepCompleted[i] ? <CheckCircle2 className="w-3 h-3" /> : <StepIcon className="w-3 h-3" />}
              <span className="hidden sm:inline">{s.title.replace("Add ", "").replace("Create ", "")}</span>
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border/40">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-30 transition-all">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <button onClick={dismiss} className="px-3 py-2 rounded-xl text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all">
            Skip all
          </button>
        </div>
        <div className="flex items-center gap-2">
          {step < steps.length - 1 && (
            <button onClick={() => setStep(step + 1)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all">
              Next <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={goToStep}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold bg-primary text-primary-foreground hover:brightness-110 transition-all">
            {current.title} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function shouldShowOnboarding(businessCount: number): boolean {
  return businessCount === 0 && !localStorage.getItem(ONBOARDING_KEY);
}

export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
}
