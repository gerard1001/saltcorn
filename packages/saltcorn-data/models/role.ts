/**
 * @category saltcorn-data
 * @module models/role
 * @subcategory models
 */

import db from "../db";
import type {
  Where,
  SelectOptions,
  Row,
  DatabaseClient,
} from "@saltcorn/db-common/internal";
import type {
  AbstractRole,
  RoleCfg,
} from "@saltcorn/types/model-abstracts/abstract_role";

/**
 * Role class
 * @category saltcorn-data
 */
class Role implements AbstractRole {
  id: number;
  role: string;

  /**
   * Role constructor
   * @param {object} o
   */
  constructor(o: RoleCfg) {
    this.id = o.id;
    this.role = o.role;
  }

  /**
   * @param {*} uo
   * @returns {Role}
   */
  public static async create(uo: RoleCfg, client?: DatabaseClient) {
    const u = new Role(uo);

    const ex = await Role.findOne({ id: u.id });
    if (ex) return { error: `Role with this id already exists` };
    await db.insert(
      "_sc_roles",
      {
        id: u.id,
        role: u.role,
      },
      { client }
    );
    return u;
  }

  /**
   * @param {*} where
   * @param {*} selectopts
   * @returns {Promise<Role[]>}
   */
  public static async find(
    where: Where,
    selectopts?: SelectOptions
  ): Promise<Role[]> {
    const us = await db.select("_sc_roles", where, selectopts);
    return us.map((u: RoleCfg) => new Role(u));
  }

  /**
   * @param {*} where
   * @returns {Promise<Role>}
   */
  public static async findOne(
    where: Where,
    selectopts?: SelectOptions
  ): Promise<Role> {
    const u: RoleCfg = await db.selectMaybeOne("_sc_roles", where, selectopts);
    return u ? new Role(u) : u;
  }

  /**
   * @returns {Promise<void>}
   */
  public async delete(client?: DatabaseClient): Promise<void> {
    const schema = db.getTenantSchemaPrefix();
    await db.query(
      `delete FROM ${schema}_sc_roles WHERE id = $1`,
      [this.id],
      client
    );
  }

  /**
   * @param {*} row
   * @returns {Promise<void>}
   */
  public async update(row: Row, client?: DatabaseClient): Promise<void> {
    await db.update("_sc_roles", row, this.id, { client });
  }
}

export = Role;
