import { useEffect, useState } from "react";
import { FaArrowUp } from "react-icons/fa";

export const GoToTop = () => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const toggleVisibility = () => setIsVisible(window.scrollY > 300);

        window.addEventListener("scroll", toggleVisibility);
        return () => window.removeEventListener("scroll", toggleVisibility);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    };

    return (
        <button
            className={`go-to-top ${isVisible ? "visible" : ""}`}
            onClick={scrollToTop}
            aria-label="Go to top"
        >
            <FaArrowUp className="go-to-top-icon"/>
        </button>
    );
};
