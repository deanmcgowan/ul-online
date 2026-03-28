import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

const APP_CACHE_PREFIX = "ul-bus-tracker";

async function clearAppServiceWorkers() {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	const registrations = await navigator.serviceWorker.getRegistrations();
	await Promise.all(registrations.map((registration) => registration.unregister()));

	if ("caches" in window) {
		const keys = await caches.keys();
		await Promise.all(
			keys
				.filter((key) => key.startsWith(APP_CACHE_PREFIX))
				.map((key) => caches.delete(key)),
		);
	}
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		const register = () => navigator.serviceWorker.register("/sw.js", {
			scope: "/",
			updateViaCache: "none",
		});

		if ("requestIdleCallback" in window) {
			window.requestIdleCallback(register);
		} else {
			window.setTimeout(register, 0);
		}
	});
} else {
	clearAppServiceWorkers().catch((error) => {
		console.warn("Failed to clear development service workers", error);
	});
}
