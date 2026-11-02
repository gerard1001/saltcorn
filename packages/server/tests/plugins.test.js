import { request as request } from "../auth/testhelp.js";
import getApp from "../app.js";
import Table from "@saltcorn/data/models/table";
import Plugin from "@saltcorn/data/models/plugin";
import { getState } from "@saltcorn/data/db/state";

import {
  getAdminLoginCookie,
  itShouldRedirectUnauthToLogin,
  toInclude,
  toNotInclude,
  toRedirect,
  toSucceed,
  resetToFixtures,
} from "../auth/testhelp.js";
import db from "@saltcorn/data/db";

beforeAll(async () => {
  // do not drop the test101 schema here: that tenant belongs to
  // plugin_install.test.js, which may be running concurrently
  await resetToFixtures();
});
afterAll(db.close);

jest.setTimeout(30000);

describe("Plugin Endpoints", () => {
  it("should show list", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins")
      .set("Cookie", loginCookie)
      .expect(toInclude("Module store"));
  });

  it("should show new", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/new")
      .set("Cookie", loginCookie)
      .expect(toInclude("New Plugin"));
  });

  itShouldRedirectUnauthToLogin("/plugins");
  itShouldRedirectUnauthToLogin("/plugins/new");

  it("should install named with config", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/plugins/install/any-bootstrap-theme")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins/configure/any-bootstrap-theme"));
    await request(app)
      .get("/plugins")
      .set("Cookie", loginCookie)
      .expect(toInclude("/plugins/configure/"));
  });
  it("should run config", async () => {
    const p = await Plugin.findOne({ name: "any-bootstrap-theme" });
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/configure/" + p.name)
      .set("Cookie", loginCookie)
      .expect(toInclude("Navbar color scheme"));
    await request(app)
      .post("/plugins/configure/" + p.name)
      .set("Cookie", loginCookie)
      .send(
        "theme=flatly&css_url=&css_integrity=&colorscheme=navbar-light&toppad=2&menu_style=Top+Navbar&stepName=stylesheet&contextEnc=%257B%257D"
      )
      .expect(toRedirect("/plugins"));
  });
  it("should show info and delete", async () => {
    const p = await Plugin.findOne({ name: "any-bootstrap-theme" });
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/info/" + p.name)
      .set("Cookie", loginCookie)
      .expect(toInclude("This plugin supplies a theme."));
    await request(app)
      .get("/plugins/public/any-bootstrap-theme/test.txt")
      .expect(toInclude("testfilecontents"));
    await request(app)
      .get("/plugins/public/sbadmin2@9.9.9/sb-admin-2.min.css")
      .expect(toInclude("Start Bootstrap"));

    await request(app)
      .post("/plugins/delete/" + p.name)
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    await request(app)
      .get("/plugins/public/sbadmin2@9.9.9/sb-admin-2.min.css")
      .expect(toInclude("Start Bootstrap"));
  });
  it("should install named without config", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/plugins/install/markdown")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    await request(app)
      .get("/plugins")
      .set("Cookie", loginCookie)
      .expect(toInclude("/plugins/delete/markdown"));
    await request(app)
      .get("/plugins/info/markdown")
      .set("Cookie", loginCookie)
      .expect(toInclude("md_to_html()"));
  });
});
describe("Plugin dependency resolution and upgrade", () => {
  it("should install quill", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/plugins/")
      .set("Cookie", loginCookie)
      .send("name=quill-editor")
      .send("source=npm")
      .send("location=%40saltcorn%2Fquill-editor")
      .expect(toRedirect("/plugins"));
    const quill = await Plugin.findOne({ name: "quill-editor" });
    expect(quill.location).toBe("@saltcorn/quill-editor");
    expect(quill.name).toBe("quill-editor");
    const html = await Plugin.findOne({ location: "@saltcorn/html" });
    expect(html.location).toBe("@saltcorn/html");
    expect(html.name).toBe("html");
    const html_type = getState().types.HTML;
    expect(!!html_type.fieldviews.Quill).toBe(true);
  });
  it("should install old tabler", async () => {
    const tabler = new Plugin({
      name: "tabler",
      source: "npm",
      location: "@saltcorn/tabler",
      version: "0.1.2",
    });
    await Plugin.loadAndSaveNewPlugin(tabler);
  });
  it("should refresh store", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/refresh")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
  });
  it("should upgrade installed", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/upgrade")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    const tabler = await Plugin.findOne({ name: "tabler" });
    expect(tabler.version).not.toBe("0.1.2");

    expect(version_to_int(tabler.version)).toBeGreaterThan(1);
    expect(version_to_int(tabler.version)).toBeLessThan(912);
  });
});

const version_to_int = (v) => +v.split(".").join("");

describe("Pack Endpoints", () => {
  it("should show get create", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/packs/create/")
      .set("Cookie", loginCookie)
      .expect(toInclude("Create Pack"));
  });
  it("should create pack", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/packs/create/")
      .set("Cookie", loginCookie)
      .send(
        "table.books=on&view.authorlist=on&view.authorshow=on&plugin.sbadmin2=on&page.a_page=on"
      )
      .expect(toInclude("You can copy the pack contents below"));
  });
  it("should offer the created pack for download beside it (#4270)", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    const res = await request(app)
      .post("/packs/create/")
      .set("Cookie", loginCookie)
      .send("table.books=on&view.authorlist=on")
      .expect(200);
    // The page still shows the pack to look at and copy; saving it is a
    // button beside it, not a choice made on the form before seeing it.
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.text).toContain("You can copy the pack contents below");
    expect(res.text).toContain("download-pack-json");
    expect(res.text).toContain("Download JSON");
    expect(res.text).toContain('class="pack-display"');
  });
  it("should not put the download choice on the create form", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    const res = await request(app)
      .get("/packs/create/")
      .set("Cookie", loginCookie)
      .expect(200);
    expect(res.text).not.toContain("download-pack-json");
  });

  it("should show get install", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/packs/install/")
      .set("Cookie", loginCookie)
      .expect(toInclude("Install Pack"));
  });
  it("should install blank pack", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/packs/install/")
      .set("Cookie", loginCookie)
      .send(
        "pack=%7B+%22tables%22%3A+%5B%5D%2C+%22views%22%3A+%5B%5D%2C+%22plugins%22%3A+%5B%5D%2C+%22pages%22%3A+%5B%5D+%7D"
      )
      .expect(toRedirect("/"));
  });

  it("should show error on wierd pack ", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/packs/install/")
      .set("Cookie", loginCookie)
      .send(
        "pack=les%22%3A+%5B%5D%2C+%22views%22%3A+%5B%5D%2C+%22plugins%22%3A+%5B%5D%2C+%22pages%22%3A+%5B%5D+%7D"
      )
      .expect(toInclude("Unexpected token"));
  });
  it("should install named", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/packs/install-named/Project%20management")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/"));
  });
  it("should validate user entry on todo", async () => {
    //db.set_sql_logging();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/view/todoedit")
      .send("description=ZAP&done=on&user=2%2F2&project=&status=Ideas")

      .expect(200)
      .expect(toInclude("Unable to read key"));
  });
  it("should uninstall named", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/packs/uninstall/Project%20management")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/"));
  });

  itShouldRedirectUnauthToLogin("/plugins/new");
});

describe("Pack clash detection", () => {
  it("should reset", async () => {
    await resetToFixtures();
  });
  it("should install issues", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/packs/install-named/Issue%20%20tracker")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/"));
  });

  it("should reset again", async () => {
    await resetToFixtures();
  });
});
describe("config endpoints", () => {
  itShouldRedirectUnauthToLogin("/admin");
  it("should show get list", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/admin/")
      .set("Cookie", loginCookie)
      .expect(toInclude("Site name"))
      .expect(toInclude("<form"));
  });

  it("should show post form", async () => {
    const loginCookie = await getAdminLoginCookie();

    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post("/admin")
      .send("site_name=FooSiteName")
      .send("multitenancy_enabled=on")
      .send("plugins_store_endpoint=https://store.saltcorn.com/api/extensions")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/admin/"));
    await request(app)
      .get("/admin")
      .set("Cookie", loginCookie)
      .expect(toInclude(">FooSiteName<"));
  });
});

const installPlugin = async (name, version) => {
  const loginCookie = await getAdminLoginCookie();
  const app = await getApp({ disableCsrf: true });
  await request(app)
    .post("/plugins")
    .send(
      `name=${encodeURIComponent(name)}&location=${encodeURIComponent(
        name
      )}&source=npm&version=${version}`
    )
    .set("Cookie", loginCookie)
    .expect(toRedirect("/plugins"));
};

const setupPluginVersion = async (name, version) => {
  let oldPlugin = await Plugin.findOne({
    name: name,
  });
  if (!oldPlugin) await installPlugin(name, version);
  else {
    oldPlugin.version = version;
    await oldPlugin.upsert();
  }
  return await Plugin.findOne({
    name: name,
  });
};
describe("Upgrade plugin to supported version", () => {
  it("upgrades to latest", async () => {
    const oldPlugin = await setupPluginVersion(
      "@christianhugoch/empty_sc_test_plugin_two",
      "0.0.1"
    );
    expect(oldPlugin.version).toBe("0.0.1");
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/upgrade")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    const upgradedPlugin = await Plugin.findOne({
      name: "@christianhugoch/empty_sc_test_plugin_two",
    });
    expect(upgradedPlugin.version).toBe("0.0.3");
  });

  it("upgrades to latest as fixed version", async () => {
    const oldPlugin = await setupPluginVersion(
      "@christianhugoch/empty_sc_test_plugin_two",
      "0.0.1"
    );
    await oldPlugin.upsert();
    expect(oldPlugin.version).toBe("0.0.1");
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post(
        `/plugins/install/${encodeURIComponent(
          "@christianhugoch/empty_sc_test_plugin_two"
        )}`
      )
      .send("version=0.0.3")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    const upgradedPlugin = await Plugin.findOne({
      name: "@christianhugoch/empty_sc_test_plugin_two",
    });
    expect(upgradedPlugin.version).toBe("0.0.3");
  });

  it("upgrades with a downgrade of latest", async () => {
    const oldPlugin = await setupPluginVersion(
      "@christianhugoch/empty_sc_test_plugin",
      "0.0.1"
    );
    expect(oldPlugin.version).toBe("0.0.1");
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/upgrade")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    const upgradedPlugin = await Plugin.findOne({
      name: "@christianhugoch/empty_sc_test_plugin",
    });
    expect(upgradedPlugin.version).toBe("0.1.0");
  });

  it("upgrades with a downgrade of latest as fixed version", async () => {
    const oldPlugin = await setupPluginVersion(
      "@christianhugoch/empty_sc_test_plugin",
      "0.0.1"
    );
    expect(oldPlugin.version).toBe("0.0.1");
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .post(
        `/plugins/install/${encodeURIComponent(
          "@christianhugoch/empty_sc_test_plugin"
        )}`
      )
      .send("version=0.2.0")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/plugins"));
    const upgradedPlugin = await Plugin.findOne({
      name: "@christianhugoch/empty_sc_test_plugin",
    });
    expect(upgradedPlugin.version).toBe("0.1.0");
  });
});

describe("Updates page", () => {
  const name = "@christianhugoch/empty_sc_test_plugin_two";
  const upgradeHref = `/plugins/upgrade-plugin/${encodeURIComponent(
    name
  )}?on_done_redirect=admin/updates`;

  const other = "@christianhugoch/empty_sc_test_plugin";
  // seed the npm "latest" cache so the page does not depend on a live
  // lookup finishing inside its 1s timeout
  const seedLatest = () =>
    getState().setConfig("latest_npm_version", {
      [name]: { time: new Date(), version: "0.0.3" },
      [other]: { time: new Date(), version: "0.2.0" },
    });

  it("lists an outdated module with its latest version", async () => {
    await setupPluginVersion(name, "0.0.1");
    await seedLatest();
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/admin/updates")
      .set("Cookie", loginCookie)
      .expect(toInclude("<td>Saltcorn</td>"))
      .expect(toInclude(`${name}</a></td><td>0.0.1</td><td>0.0.3</td>`))
      .expect(toInclude(upgradeHref))
      .expect(toInclude("Upgrade all modules ("));
  });

  it("shows the latest supported version, not the newest published", async () => {
    // 0.2.0 is published but requires a newer Saltcorn; 0.1.0 is the
    // newest this version supports
    await setupPluginVersion(other, "0.0.1");
    await seedLatest();
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    const res = await request(app)
      .get("/admin/updates")
      .set("Cookie", loginCookie);
    expect(res.text).toMatch(
      new RegExp(`${other}</a></td><td>[^<]*</td><td>0\\.1\\.0</td>`)
    );
  });

  it("upgrades one module and returns to the Updates page", async () => {
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get(upgradeHref)
      .set("Cookie", loginCookie)
      .expect(toRedirect("/admin/updates"));
    const upgraded = await Plugin.findOne({ name });
    expect(upgraded.version).toBe("0.0.3");
    await seedLatest();
    await request(app)
      .get("/admin/updates")
      .set("Cookie", loginCookie)
      .expect(toInclude(`${name}</a></td><td>0.0.3</td><td>0.0.3</td>`))
      .expect(toNotInclude(upgradeHref));
  });

  it("refreshes the version cache", async () => {
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await getState().setConfig("latest_npm_version", {
      [name]: { time: new Date(), version: "0.0.3" },
    });
    await request(app)
      .post("/admin/updates/check")
      .set("Cookie", loginCookie)
      .expect(toRedirect("/admin/updates"));
    expect(getState().getConfig("latest_npm_version", {})).toEqual({});
  });
});

describe("install a different version dialog", () => {
  it("sends the dialog", async () => {
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get("/plugins/versions_dialog/any-bootstrap-theme")
      .set("Cookie", loginCookie)
      .expect(toInclude(["0.5.14", "0.5.14", "0.5.13", "0.5.12", "0.1.0"]));
  });

  it("filters not supported versions", async () => {
    await installPlugin("@christianhugoch/empty_sc_test_plugin", "latest");
    const loginCookie = await getAdminLoginCookie();
    const app = await getApp({ disableCsrf: true });
    await request(app)
      .get(
        `/plugins/versions_dialog/${encodeURIComponent(
          "@christianhugoch/empty_sc_test_plugin"
        )}`
      )
      .set("Cookie", loginCookie)
      .expect(
        toInclude([
          "0.0.1",
          "0.0.2",
          "0.0.3",
          "0.0.4",
          "0.0.5",
          "0.0.6",
          "0.1.0",
        ])
      );
  });
});
