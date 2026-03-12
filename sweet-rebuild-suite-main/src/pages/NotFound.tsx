import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { stagger, fadeUp, scaleIn } from "@/utils/animations";

const NotFound = () => {
  const location = useLocation();
  useEffect(() => { console.error("404:", location.pathname); }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <motion.div variants={stagger} initial="hidden" animate="visible" className="text-center">
        <motion.div variants={scaleIn} className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl font-display font-bold text-primary">404</span>
        </motion.div>
        <motion.p variants={fadeUp} className="text-lg font-display font-semibold text-foreground mb-2">Page not found</motion.p>
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground mb-6">The page you're looking for doesn't exist.</motion.p>
        <motion.a variants={fadeUp} href="/" className="premium-btn-primary inline-flex">Return to Dashboard</motion.a>
      </motion.div>
    </div>
  );
};

export default NotFound;
