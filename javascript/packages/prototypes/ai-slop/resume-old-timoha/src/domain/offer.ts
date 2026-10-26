import type { TStore } from "../store/store";

const hireAction = (store: TStore) => {
  store.offer.hired.value = true;
};

const setSalaryAction = (store: TStore, salary: number) => {
  store.offer.salary.value = salary;
};

export { hireAction, setSalaryAction };
