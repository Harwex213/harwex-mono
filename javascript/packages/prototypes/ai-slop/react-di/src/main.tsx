import React, { ComponentType, createContext, createElement, memo, useContext, } from "react";
import { createRoot } from "react-dom/client";

// -------------------- DI ------------------


type TWidgetStrategy = "strategy1" | "strategy2";

interface IWidgetContainerContext {
  WidgetTitleContainer: ComponentType<IWidgetTitleContainerProps>;
}

const WidgetContainerContext = createContext<IWidgetContainerContext>(
  null!
);

type TWidgetContainerProps = {
  name: keyof IWidgetContainerContext;
};

const WidgetContainer: ComponentType<TWidgetContainerProps> = ({ name, ...props }) => {
  const Containers = useContext(WidgetContainerContext);
  const Container = Containers[name];

  return createElement(Container, props);
};

// -------------------- Widget ------------------

interface IWidgetTitleProps {
  title: string;
}

const Widget = memo(() => (
  <WidgetContainer name={"WidgetTitleContainer"}>
    {
      ({ title }) => <h1>{title}</h1>
    }
  </WidgetContainer>
));

// ---------- Widget Title Containers -----------

interface IWidgetTitleContainerProps {
  children: (props: IWidgetTitleProps) => React.ReactNode;
}

const WidgetTitleContainerStrategyOne: ComponentType<IWidgetTitleContainerProps> = (({ children }) => {
    const title = "Strategy1ContainerData";

    return children({ title });
  }
);

const WidgetTitleContainerStrategyTwo: ComponentType<IWidgetTitleContainerProps> = (({ children }) => {
    const title = "Strategy2ContainerData";

    return children({ title });
  }
);

const WIDGET_TITLE_CONTAINER_STRATEGY_MAP: Record<
  TWidgetStrategy,
  ComponentType<IWidgetTitleContainerProps>
> = {
  ["strategy1"]: WidgetTitleContainerStrategyOne,
  ["strategy2"]: WidgetTitleContainerStrategyTwo,
};

// ------ Some Root Component Widget Usage -----

export default function App() {
  const diCtxV1 = {
    WidgetTitleContainer: WIDGET_TITLE_CONTAINER_STRATEGY_MAP["strategy1"],
  };

  const diCtxV2 = {
    WidgetTitleContainer: WIDGET_TITLE_CONTAINER_STRATEGY_MAP["strategy2"],
  }

  return (
    <div>
      <WidgetContainerContext value={diCtxV1}>
        <Widget />
      </WidgetContainerContext>

      <WidgetContainerContext value={diCtxV2}>
        <Widget />
      </WidgetContainerContext>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
