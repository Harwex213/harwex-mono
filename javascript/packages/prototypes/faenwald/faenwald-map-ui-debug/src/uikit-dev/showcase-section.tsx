import { type FC, type ReactNode } from "react";
import s from "./showcase-section.module.css";

type TShowcaseSectionProps = {
  title: string;
  children: ReactNode;
};

export const ShowcaseSection: FC<TShowcaseSectionProps> = ({ title, children }) => (
  <div className={s.section}>
    <h3 className={s.title}>{title}</h3>
    <div className={s.content}>{children}</div>
  </div>
);
