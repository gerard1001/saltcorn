/*global saltcorn */
import { apiCall } from "../../helpers/api";
import { setHasOfflineData, hasOfflineRows } from "../../helpers/offline_mode";
import i18next from "i18next";

// post/delete/:name/:id
export const deleteRows = async (context) => {
  const { tableName, id } = context.params;
  const table = await saltcorn.data.models.Table.findOne({ name: tableName });
  const { isOfflineMode, user } = saltcorn.data.state.getState().mobileConfig;
  if (isOfflineMode) {
    const role = user?.role_id || 100;
    const where = { [table.pk_name]: id };
    if (role <= table.min_role_write) {
      await table.deleteRows(where, user);
    } else if ((table.ownership_field_id || table.ownership_formula) && user) {
      const row = await table.getJoinedRow({
        where,
        forUser: user,
        forPublic: !user,
      });
      if (row && table.is_owner(user, row)) {
        await table.deleteRows(where, user);
      } else {
        throw new saltcorn.data.utils.NotAuthorized(
          i18next.t("Not authorized")
        );
      }
    } else {
      throw new saltcorn.data.utils.NotAuthorized(i18next.t("Not authorized"));
    }
    if (await hasOfflineRows()) await setHasOfflineData(true);
  } else {
    await apiCall({ method: "POST", path: `/delete/${tableName}/${id}` });
  }
  const redirect = context.data?.after_delete_url
    ? context.data.after_delete_url === "/"
      ? "/"
      : `get${new URL(context.data?.after_delete_url).pathname}`
    : new URLSearchParams(context.query).get("redirect");
  return { redirect };
};
