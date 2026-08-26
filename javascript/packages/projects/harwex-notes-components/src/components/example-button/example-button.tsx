import "./example-button.css";
import type { FC, ReactNode } from "react";

type TExampleButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "primary" | "ghost";
};

const ExampleButton: FC<TExampleButtonProps> = ({
  children,
  disabled = false,
  onClick,
  variant = "primary",
}) => {
  return (
    <button
      className={`example-button example-button--${variant}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
};

export { ExampleButton };
export type { TExampleButtonProps };
