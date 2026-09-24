// --- Render Lib ---

const createUseState = (callRerender, getCallingComponent, componentsState) => {
  let hookState = undefined;
  const updateState = (nextState) => {
    if (!hookState) {
      return;
    }

    hookState.value = nextState;

    callRerender();
  };

  return (initialValue) => {
    const componentId = getCallingComponent();
    const component = componentsState.get(componentId);

    const hookId = component.currentHook;
    component.currentHook++;

    hookState = component.hookState.get(hookId);

    if (!hookState) {
      hookState = { value: initialValue };
      component.hookState.set(hookId, hookState);
    }

    return [hookState.value, updateState];
  };
};

const createRenderer = () => {
  let currentlyRenderingComponent = undefined;
  const componentsState = new Map();

  const render = (rootComponent) => {
    currentlyRenderingComponent = rootComponent;
    const currentlyRenderingComponentState = {
      currentHook: 0,
      hookState: new Map(),
    };
    componentsState.set(currentlyRenderingComponent, currentlyRenderingComponentState);

    console.log(`render ${rootComponent.displayName}`);
    let nextComponent = rootComponent();
    currentlyRenderingComponentState.currentHook = 0;

    while (nextComponent !== null) {
      currentlyRenderingComponent = nextComponent.type;

      const currentlyRenderingComponentState = {
        currentHook: 0,
        hookState: new Map(),
      };
      componentsState.set(currentlyRenderingComponent, currentlyRenderingComponentState);

      if (typeof nextComponent.type === "function") {
        console.log(`render ${nextComponent.type.displayName}`);
        nextComponent = nextComponent.type(nextComponent.props);
      } else if (nextComponent.type === "div") {
        console.log(`render div: ${nextComponent.children}`);
        nextComponent = null;
      } else {
        nextComponent = null;
      }

      currentlyRenderingComponentState.currentHook = 0;
    }
  };

  const getCallingComponent = () => currentlyRenderingComponent;

  return {
    render,
    callRerender: render,
    getCallingComponent,
    componentsState,
  }
};

const renderer = createRenderer();
const useState = createUseState(
  renderer.callRerender,
  renderer.getCallingComponent,
  renderer.componentsState,
);

// --- App ---

const MyComponent = ({ state }) => {
  return {
    type: "div",
    children: state
  };
};
MyComponent.displayName = "MyComponent";

const App = () => {
  const [state, setState] = useState(1);

  return {
    type: MyComponent,
    props: { state },
  };
};
App.displayName = "App";

renderer.render(App);

/**
 * Реализация вышла достаточно наивной и не законченной
 *
 * Тут также есть много багов, например если я попробую отрендерить несколько div'ов,
 * то у них будет единый componentState (ибо type это ключ и он у них будет одинаковый)
 */
