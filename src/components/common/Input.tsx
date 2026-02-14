import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  icon?: ReactNode;
  helper?: string;
};

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, helper, className, ...props }, ref) => {
    return (
      <label className="flex flex-col gap-2 text-sm text-text-secondary">
        {label && (
          <span className="text-xs uppercase tracking-[0.3em] text-text-muted">
            {label}
          </span>
        )}
        <span className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={`input-field ${icon ? "pl-10" : ""} ${
              error ? "border-accent-red focus:border-accent-red" : ""
            } ${className ?? ""}`}
            {...props}
          />
        </span>
        {helper && !error && <span className="text-xs text-text-muted">{helper}</span>}
        {error && <span className="text-xs text-accent-red">{error}</span>}
      </label>
    );
  }
);

Input.displayName = "Input";

export default Input;
