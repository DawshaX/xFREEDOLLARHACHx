import { createRoot } from "react-dom/client";
// The runtime shims MUST evaluate before the app graph: ES modules run in import
// order, and modules that fetch at load time (the fleet strip does) would
// otherwise call the browser's raw fetch and get a 404 instead of the engine.
import "./setup";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
