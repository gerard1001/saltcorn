/*global saltcorn */

import { MobileRequest } from "../mocks/request";
import { MobileResponse } from "../mocks/response";
import { parseQuery, wrapContents } from "../utils";
import { loadFileAsText } from "../../helpers/common";
import { apiCall } from "../../helpers/api";

// post/page/:pagename/action/:rndid
export const postPageAction = async (context) => {
  const { user, isOfflineMode } = saltcorn.data.state.getState().mobileConfig;
  const req = new MobileRequest({ xhr: context.xhr });
  const { page_name, rndid } = context.params;
  const page = await saltcorn.data.models.Page.findOne({ name: page_name });
  if (!page) throw new Error(req.__("Page %s not found", page_name));
  if (user.role_id > page.min_role) {
    throw new saltcorn.data.utils.NotAuthorized(req.__("Not authorized"));
  }
  let col;
  saltcorn.data.models.layout.traverseSync(page.layout, {
    action(segment) {
      if (segment.rndid === rndid) col = segment;
    },
  });

  if (isOfflineMode) {
    const result = await saltcorn.data.plugin_helper.run_action_column({
      col,
      referrer: "",
      req,
    });
    return result || {};
  } else {
    const response = await apiCall({
      method: "POST",
      path: `/page/${page_name}/action/${rndid}`,
    });
    return response.data || {};
  }
};

const findPageOrGroup = (pagename) => {
  const page = saltcorn.data.models.Page.findOne({ name: pagename });
  if (page) return { page, pageGroup: null };
  else {
    const pageGroup = saltcorn.data.models.PageGroup.findOne({
      name: pagename,
    });
    if (pageGroup) return { page: null, pageGroup };
    else return { page: null, pageGroup: null };
  }
};

const runPage = async (page, state, context, { req, res }) => {
  if (state.mobileConfig.user.role_id > page.min_role) {
    const additionalInfos = `: your role: ${state.mobileConfig.user.role_id}, page min_role: ${page.min_role}`;
    throw new saltcorn.data.utils.NotAuthorized(
      req.__("Not authorized") + additionalInfos
    );
  }
  const query = parseQuery(context.query);
  return await page.run(query, { req, res });
};

const getEligiblePage = async (pageGroup, req) => {
  const screenInfos = {
    width: window.screen.width,
    height: window.screen.height,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    device: "mobile", // TODO UAParser knows tablet and mobile
  };
  if (pageGroup.members.length === 0)
    return req.__("Pagegroup %s has no members", pageGroup.name);
  return await pageGroup.getEligiblePage(
    screenInfos,
    req.user,
    req.getLocale()
  );
};

const runPageGroup = async (pageGroup, state, context, { req, res }) => {
  if (state.mobileConfig.user.role_id > pageGroup.min_role) {
    const additionalInfos = `: your role: ${state.mobileConfig.user.role_id}, pagegroup min_role: ${pageGroup.min_role}`;
    throw new saltcorn.data.utils.NotAuthorized(
      req.__("Not authorized") + additionalInfos
    );
  }
  const page = await getEligiblePage(pageGroup, req);
  if (!page)
    throw new Error(req.__(`Pagegroup ${pageGroup.name} has no eligible page`));
  else if (typeof page === "string") throw new Error(page);
  return await runPage(page, state, context, { req, res });
};

// get/page/pagename
export const getPage = async (context) => {
  const state = saltcorn.data.state.getState();
  const query = context.query ? parseQuery(context.query) : {};
  const req = new MobileRequest({ xhr: context.xhr, query: query });
  const res = new MobileResponse();
  const { page_name } = context.params;
  const { page, pageGroup } = findPageOrGroup(page_name);
  let contents = null;
  state.queriesCache = {};
  try {
    if (page) contents = await runPage(page, state, context, { req, res });
    else if (pageGroup)
      contents = await runPageGroup(pageGroup, state, context, { req, res });
    else throw new Error(req.__("Page %s not found", page_name));
  } finally {
    state.queriesCache = null;
  }
  if (contents.html_file) {
    if (state.mobileConfig?.isOfflineMode)
      throw new Error(req.__("Offline mode: cannot load file"));
    const content = await loadFileAsText(contents.html_file);
    return { content, title: "title", replaceIframe: true, isFile: true };
  } else {
    const title = "title"; // TODO
    return await wrapContents(contents, title, context, req);
  }
};
