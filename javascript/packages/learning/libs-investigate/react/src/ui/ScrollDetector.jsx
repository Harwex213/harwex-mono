import { useEffect, useState } from "react";

const ScrollDetector = ({ children }) => {
    const [scroll, setScroll] = useState(0);

    console.log("ScrollDetector: render-app", scroll);

    useEffect(() => {
        document.addEventListener("scroll", () => {
            setScroll(window.scrollY);
        });
    });

    return <div style={{ height: "200dvh" }}>{children(scroll)}</div>;
};

const ScrollDetectorChildren = () => {
    console.log("ScrollDetectorChildren: render-app");

    return <div>chipi chipi chapi chapi</div>;
};

const ScrollDetectorApp = () => {
    const scrollChildren = <ScrollDetectorChildren />;

    return <ScrollDetector>{(scroll) => (scroll > 200 ? scrollChildren : null)}</ScrollDetector>;
};

export { ScrollDetectorApp };
