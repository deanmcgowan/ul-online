import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" });
		if ("requestIdleCallback" in window) {
			window.requestIdleCallback(register);
		} else {
			window.setTimeout(register, 0);
		}
	});
}
