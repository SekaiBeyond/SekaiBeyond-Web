import { useEffect, useState } from "react";
import { FaArrowUp } from "react-icons/fa";
import { useLanguage } from "~/components/LanguageContextProvider";

export const GoToTop = () => {
    const [isVisible, setIsVisible] = useState(false);
    const {isEnglish} = useLanguage();

    useEffect(() => {
        const toggleVisibility = () => setIsVisible(window.scrollY > 300);

        window.addEventListener("scroll", toggleVisibility, {passive: true});
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
            aria-label={isEnglish ? "Go to top" : "回到顶部"}
        >
            <FaArrowUp className="go-to-top-icon"/>
        </button>
    );
};
