import { useMemo } from "react";
import { GroupedVirtuoso } from "react-virtuoso";
import clsx from "clsx";
import classes from "./app.module.css";

const List = () => {
  const groupCounts = useMemo(() => Array<number>(1000).fill(10), []);

  return (
    <GroupedVirtuoso
      style={{ height: "100%" }}
      groupCounts={groupCounts}
      groupContent={(index) => (
        <div style={{ backgroundColor: "var(--background)" }}>Group {index * 10} - {(index * 10) + 10}</div>
      )}
      itemContent={(index, groupIndex) => (<div>{index} (group {groupIndex})</div>)}
    />
  );
};

const App = () => {
  console.log(123);

  return (
    <div className={clsx(classes.variables)}>
      <List/>
    </div>
  );
};

export { App };
