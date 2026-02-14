import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { HTMLMotionProps } from "framer-motion";

const variants = {
  primary: "epic-button",
  secondary: "epic-button-secondary",
  ghost: "bg-transparent text-text-secondary hover:text-text-primary",
  danger: "bg-accent-red/15 text-accent-red border border-accent-red/30 hover:bg-accent-red/25 rounded-xl"
};

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base"
};

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  icon?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
};

export default function Button({
  variant = "primary",
  size = "md",
  icon,
  loading,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={`inline-flex items-center gap-2 font-semibold transition ${
        variants[variant]
      } ${sizes[size]} ${loading ? "opacity-60" : ""} ${className ?? ""}`}
      {...props}
      disabled={loading || props.disabled}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-text-primary" />
      ) : (
        icon
      )}
      {children}
    </motion.button>
  );
}
