import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Outlet } from "react-router-dom";

interface Props {
  context: Record<string, unknown>;
}

export default function AnimatedOutlet({ context }: Props) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Outlet context={context} />
      </motion.div>
    </AnimatePresence>
  );
}
