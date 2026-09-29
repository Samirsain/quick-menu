import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/pwa"; // catches the install prompt early and registers the service worker

createRoot(document.getElementById("root")!).render(<App />);
