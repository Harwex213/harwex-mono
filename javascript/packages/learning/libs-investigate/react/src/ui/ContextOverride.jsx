import { createContext, useContext } from "react";

const ServiceContext = createContext({});

const Provider = ({ children, service }) => {
    const context = useContext(ServiceContext);

    const value = { ...context, ...service };

    return <ServiceContext.Provider value={value}>{children}</ServiceContext.Provider>;
};

const Consumer1 = () => {
    const { getTitle } = useContext(ServiceContext);

    return <div>{getTitle()}</div>;
};

const ConsumerContainer = ({ children }) => <Provider service={{ getTitle: () => "title 2" }}>{children}</Provider>;

const Consumer2 = () => {
    const { getTitle, getData } = useContext(ServiceContext);

    return (
        <div>
            <div>{getTitle()}</div>

            <div>{getData()}</div>
        </div>
    );
};

const ContextOverride = () => {
    return (
        <Provider service={{ getTitle: () => "title 1", getData: () => "data" }}>
            <div>
                <Consumer1 />

                <ConsumerContainer>
                    <Consumer2 />
                </ConsumerContainer>
            </div>
        </Provider>
    );
};

export { ContextOverride };
