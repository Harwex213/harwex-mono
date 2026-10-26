export type THireAction = () => void;

export type TSetSalaryAction = (salary: number) => void;

export type TAppRegistry = {
  hireAction: THireAction;
  setSalaryAction: TSetSalaryAction;
};
