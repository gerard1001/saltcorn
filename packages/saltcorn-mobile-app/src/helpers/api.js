/*global saltcorn, splashConfig*/

import axios from "axios";
import { jwtDecode } from "jwt-decode";
import { router } from "../routing/index";
import { replaceIframe, clearHistory } from "./navigation";

export async function apiCall({
  method,
  path,
  params,
  body,
  responseType,
  timeout,
  additionalHeaders,
}) {
  const config =
    typeof saltcorn !== "undefined"
      ? saltcorn.data.state.getState().mobileConfig
      : splashConfig;
  const serverPath = config.server_path;
  const url = `${serverPath}${path}`;
  const headers = {
    "X-Requested-With": "XMLHttpRequest",
    "X-Saltcorn-Client": "mobile-app",
    ...(additionalHeaders || {}),
  };
  if (config.tenantAppName) headers["X-Saltcorn-App"] = config.tenantAppName;
  const token = config.jwt;
  if (token) {
    try {
      const decoded = jwtDecode(token);
      if (decoded.exp && decoded.exp < Date.now() / 1000 && typeof saltcorn !== "undefined" && !path.startsWith("/auth/")) {
        const mobileConfig = saltcorn.data.state.getState().mobileConfig;
        mobileConfig.jwt = undefined;
        await saltcorn.data.db.deleteWhere("jwt_table");
        clearHistory();
        const page = await router.resolve({
          pathname: "get/auth/login",
          alerts: [
            { type: "warning", msg: "Your session has expired, please log in again." },
          ],
        });
        await replaceIframe(page.content);
        return;
      }
    } catch {
      // malformed token, let the request proceed and fail naturally
    }
    headers.Authorization = `jwt ${token}`;
  }
  try {
    const result = await axios({
      url: url,
      method,
      params,
      headers,
      responseType: responseType ? responseType : "json",
      data: body,
      timeout: timeout ? timeout : 0,
    });
    return result;
  } catch (error) {
    error.message = `Unable to call ${method} ${url}:\n${error.message}`;
    throw error;
  }
}
