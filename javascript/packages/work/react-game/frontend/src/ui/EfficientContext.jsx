import { createContext, useContext, useState } from "react";

const MyContext = createContext(1);
const MyContext$2 = createContext(() => void 0);

const Child$2 = () => {
    const value = useContext(MyContext);
    console.log("Child$2", "I triggered by context");
    return <div>{value}</div>;
};

const Child$3 = () => {
    const setValue = useContext(MyContext$2);
    console.log("Child$3", "I render-app only once with context");
    return <button onClick={() => setValue((p) => ++p)}>Click</button>;
};

const Children$1 = () => {
    console.log("Children$1", "I render-app only once");
    return (
        <div>
            <Child$2 />
            <Child$3 />
        </div>
    );
};

const MyContextProvider = ({ children }) => {
    const state = useState(1);
    return (
        <MyContext$2.Provider value={state[1]}>
            <MyContext.Provider value={state[0]}>{children}</MyContext.Provider>
        </MyContext$2.Provider>
    );
};

const EfficientContext = () => {
    return (
        <MyContextProvider>
            <Children$1 />
        </MyContextProvider>
    );
};

export { EfficientContext };
