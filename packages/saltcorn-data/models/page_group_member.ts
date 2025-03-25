import {
  AbstractPageGroupMember,
  PageGroupMemberCfg,
} from "@saltcorn/types/model-abstracts/abstract_page_group_member";
import {
  DatabaseClient,
  Row,
  SelectOptions,
  Where,
} from "@saltcorn/db-common/internal";
import db from "../db";
import type { ConnectedObjects } from "@saltcorn/types/base_types";
import utils from "../utils";
const { satisfies } = utils;

/**
 * PageGroupMember class
 */
class PageGroupMember implements AbstractPageGroupMember {
  id?: number;
  description?: string;
  page_group_id: number;
  page_id: number;
  sequence: number;
  eligible_formula: string;
  constructor(cfg: PageGroupMemberCfg) {
    this.id = cfg.id;
    if (!cfg.page_group_id) throw new Error("page_group_id is required");
    this.page_group_id = cfg.page_group_id;
    this.page_id = cfg.page_id;
    this.sequence = cfg.sequence || 0;
    this.eligible_formula = cfg.eligible_formula;
    this.description = cfg.description;
  }

  /**
   * find members
   * @param where
   * @param selectopts
   * @returns an array of page group members
   */
  static async find(
    where?: Where,
    selectopts: SelectOptions = {}
  ): Promise<PageGroupMember[]> {
    if (selectopts.cached) {
      const { getState } = require("../db/state");
      const groups = getState().page_groups;
      const allMembers = [];
      for (const group of groups) {
        allMembers.push(...group.members);
      }
      return allMembers
        .map((m) => new PageGroupMember(m))
        .filter(satisfies(where || {}));
    } else {
      const db_flds = await db.select(
        "_sc_page_group_members",
        where,
        selectopts
      );
      return db_flds.map((dbf: PageGroupMember) => new PageGroupMember(dbf));
    }
  }

  static findOne(where: number | FindOneObj): PageGroupMember | null {
    const { getState } = require("../db/state");
    const groups = getState().page_groups;
    let pred = PageGroupMember.findPred(where);
    if (!pred) throw new Error("Invalid where");
    for (const group of groups) {
      const member = group.members.find(pred);
      if (member) return member;
    }
    return null;
  }

  /**
   * for internal use
   */
  static findPred(where: number | FindOneObj) {
    let pred = null;
    if (typeof where === "number" || typeof where === "string") {
      const searchId = +where;
      pred = (m: AbstractPageGroupMember) => m.id === searchId;
    } else if (instanceOfFindOneObj(where))
      pred = where.id
        ? (m: AbstractPageGroupMember) => m.id === +where.id!
        : where.page_group_id && where.sequence
          ? (m: AbstractPageGroupMember) =>
              m.page_group_id === where.page_group_id &&
              m.sequence === where.sequence
          : null;
    return pred;
  }

  /**
   * create a page group member
   * @param f
   * @returns the created member
   */
  static async create(
    f: PageGroupMemberCfg,
    client?: DatabaseClient
  ): Promise<PageGroupMember> {
    const pageGroupMember = new PageGroupMember(f);
    const { id, ...rest } = pageGroupMember;
    const fid = await db.insert("_sc_page_group_members", rest, { client });
    pageGroupMember.id = fid;

    return pageGroupMember;
  }

  /**
   * update a page group member
   * @param id id of the member
   * @param row values to update
   */
  static async update(
    id: number,
    row: Row,
    client?: DatabaseClient
  ): Promise<void> {
    await db.update("_sc_page_group_members", row, id, { client });
  }

  /**
   * delete this page group member
   */
  async delete(client?: DatabaseClient): Promise<void> {
    if (!this.id) throw new Error("Cannot delete page group member without id");
    await PageGroupMember.delete(this.id, client);
  }

  /**
   * delete one page group member
   * @param id id of the member
   */
  static async delete(id: number, client?: DatabaseClient): Promise<void> {
    await db.deleteWhere("_sc_page_group_members", { id }, { client });
  }

  connected_objects(): ConnectedObjects {
    return {};
  }
}

type FindOneObj = {
  page_group_id?: number;
  sequence?: number;
  id?: number | string;
  name?: string;
};

function instanceOfFindOneObj(object: any): object is FindOneObj {
  return (
    object &&
    typeof object !== "string" &&
    (("page_group_id" in object &&
      ("sequence" in object || "name" in object)) ||
      "id" in object)
  );
}

export = PageGroupMember;
