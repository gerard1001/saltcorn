import type { FieldView, FieldLike, Req,Res } from "./base_types";
import type { AbstractTable } from "./model-abstracts/abstract_table";

/**
 * Those are the common types
 * @module
 */
export type ErrorMessage = {
  error: string;
  details?: string;
  errors?: string[];
};

export type SuccessMessage = {
  success: any;
  table?: any;
  rows?: any;
  details?: string;
};

export type ReqRes = {
  req: Req;
  res?: Res;
};

export type ResultMessage = ErrorMessage | SuccessMessage;

export const instanceOfErrorMsg = (object: any): object is ErrorMessage => {
  return object && "error" in object;
};

export const instanceOfSuccessMsg = (object: any): object is SuccessMessage => {
  return object && "success" in object;
};

export type Type = {
  name: string;
  sql_name?: string | ((attrs: any) => string);
  js_type?: string;
  readFromDB?: (arg0: any) => any;
  read?: (arg0: any, arg1?: any) => any;
  readFromFormRecord?: Function;
  postProcess?: Function;
  validate?: Function;
  listAs?: Function;
  showAs?: Function;
  primaryKey?: { sql_type: string; default_sql?: string };
  presets?: any;
  contract?: any;
  fieldviews?: Record<string, FieldView>;
  attributes?:
    | Array<FieldLike>
    | (({ table }: { table: AbstractTable }) => Promise<Array<FieldLike>>);
  validate_attributes?: Function;
  distance_operators?: { [opName: string]: any };
};

export function instanceOfType(object: any): object is Type {
  return object && typeof object !== "string";
}

export type GenObj = { [key: string]: any };
