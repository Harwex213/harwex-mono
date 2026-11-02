import { useEffect, useRef, useState } from "react";
import type { FC } from "react";

type TCopyButtonProps = {
  label: string;
  copy: () => Promise<boolean>;
  primary?: boolean;
};

const CopyButton: FC<TCopyButtonProps> = ({ label, copy, primary }) => {
  const [result, setResult] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
    };
  }, []);

  const onClick = async () => {
    const ok = await copy();
    setResult(ok ? "Скопировано" : "Не вышло");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(null), 1500);
  };

  return (
    <button type="button" className={primary ? "button button-primary" : "button"} onClick={onClick}>
      {result ?? label}
    </button>
  );
};

export { CopyButton };
