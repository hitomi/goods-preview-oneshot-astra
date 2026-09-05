import React from "react";
import ReactDOM from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
  Link,
} from "@tanstack/react-router";
import { createProject } from "./domain/catalog";
import { listProjects, saveProject } from "./lib/storage";
import { Studio } from "./components/Studio";
import { Projects } from "./components/Projects";
import "./styles.css";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="full-state">
      <h1>这个工作台地址不存在</h1>
      <Link className="button primary" to="/projects">
        打开本机项目库
      </Link>
    </div>
  ),
  errorComponent: () => (
    <div className="full-state">
      <h1>工作台暂时无法打开</h1>
      <p>本机数据没有被主动删除。请刷新重试，或检查浏览器是否允许本地存储。</p>
      <button className="button primary" onClick={() => location.reload()}>
        重新打开
      </button>
    </div>
  ),
});
let bootstrap: Promise<string> | undefined;
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
    bootstrap ??= (async () => {
      const projects = await listProjects();
      if (projects.length) return projects[0].id;
      const sample = createProject("badge", "森间来信 · 吧唧");
      await saveProject(sample);
      return sample.id;
    })().catch((error) => {
      bootstrap = undefined;
      throw error;
    });
    const id = await bootstrap;
    bootstrap = undefined;
    throw redirect({ to: "/studio/$projectId", params: { projectId: id } });
  },
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: Projects,
});
const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/$projectId",
  component: () => {
    const { projectId } = studioRoute.useParams();
    return <Studio key={projectId} id={projectId} />;
  },
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, projectsRoute, studioRoute]),
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
