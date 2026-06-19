import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { routeName, useRoute } from "./useRoute";
import { Landing } from "./views/Landing";
import "./index.css";

// Two routes: "/" is the marketing landing page, "/app" is the studio. A tiny custom router (useRoute)
// keeps this dependency-free; Vercel rewrites every path to index.html so deep links and reloads work.
function Root() {
  const route = useRoute();
  return routeName(route.path) === "/app" ? <App route={route} /> : <Landing route={route} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
