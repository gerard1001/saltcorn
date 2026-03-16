/**
 * SC service API handler
 * Allows to list tables, views, etc
 * @category server
 * @module routes/scapi
 * @subcategory routes
 */

/** @type {module:express-promise-router} */
const Router = require("express-promise-router");
//const db = require("@saltcorn/data/db");
const fs = require("fs");
const path = require("path");
const { error_catcher } = require("./utils.js");
const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const File = require("@saltcorn/data/models/file");
const Trigger = require("@saltcorn/data/models/trigger");
const Role = require("@saltcorn/data/models/role");
const Tenant = require("@saltcorn/admin-models/models/tenant");
const Plugin = require("@saltcorn/data/models/plugin");
const Config = require("@saltcorn/data/models/config");
const { edit_build_in_actions } = require("@saltcorn/data/viewable_fields");
const passport = require("passport");

const {
  stateFieldsToWhere,
  readState,
} = require("@saltcorn/data/plugin-helper");
const {
  getState,
  process_send,
  add_tenant,
} = require("@saltcorn/data/db/state");
const db = require("@saltcorn/data/db");
const { loadAllPlugins } = require("../load_plugins");
const { text } = require("@saltcorn/markup/tags");

const builderPackageRoot = (() => {
  try {
    return path.dirname(require.resolve("@saltcorn/builder/package.json"));
  } catch (e) {
    return null;
  }
})();

const resolveBuilderPath = (...segments) => {
  if (builderPackageRoot) return path.join(builderPackageRoot, ...segments);
  return path.resolve(process.cwd(), "packages/saltcorn-builder", ...segments);
};

const BUILDER_SCHEMA_TTL_MS = 5 * 60 * 1000;
const builderSchemaCache = new Map();
let toolboxComponentsCache = null;
let craftMetadataCache = null;
let settingsConstraintsCache = null;
let textStyleOptionsCache = null;

const isAdminSession = (req) => req.user && req.user.role_id === 1;

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const safeReadFile = (filePath) => {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return null;
  }
};

const extractPropNamesFromContent = (content) => {
  const names = new Set();
  const nodePropRegex = /node\.data\.props\.([A-Za-z0-9_]+)/g;
  let match;
  while ((match = nodePropRegex.exec(content))) {
    names.add(match[1]);
  }
  const setPropRegex = /prop\.([A-Za-z0-9_]+)\s*=/g;
  while ((match = setPropRegex.exec(content))) {
    names.add(match[1]);
  }
  return Array.from(names);
};

const loadTextStyleOptions = () => {
  if (textStyleOptionsCache) return textStyleOptionsCache;
  const utilsPath = resolveBuilderPath("src/components/elements/utils.js");
  const content = safeReadFile(utilsPath);
  if (!content) {
    textStyleOptionsCache = [];
    return textStyleOptionsCache;
  }
  const selectIdx = content.indexOf("const TextStyleSelect");
  if (selectIdx === -1) {
    textStyleOptionsCache = [];
    return textStyleOptionsCache;
  }
  const sliceEnd = content.indexOf("const textStyleToArray", selectIdx);
  const slice = content.slice(
    selectIdx,
    sliceEnd === -1 ? selectIdx + 800 : sliceEnd
  );
  const optionRegex = /<option\s+value="([^"]*)"/g;
  const values = new Set();
  let match;
  while ((match = optionRegex.exec(slice))) {
    values.add(match[1]);
  }
  textStyleOptionsCache = Array.from(values);
  return textStyleOptionsCache;
};

const findMatchingBracket = (text, startIndex, openChar, closeChar) => {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const splitTopLevel = (text, delimiter = ",") => {
  const parts = [];
  let buf = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      buf += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = "";
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringChar = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depthParen += 1;
    if (ch === ")") depthParen -= 1;
    if (ch === "{") depthBrace += 1;
    if (ch === "}") depthBrace -= 1;
    if (ch === "[") depthBracket += 1;
    if (ch === "]") depthBracket -= 1;
    if (
      ch === delimiter &&
      depthParen === 0 &&
      depthBrace === 0 &&
      depthBracket === 0
    ) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const trimmed = buf.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
};

const parseDefaultValue = (raw) => {
  if (!raw) return undefined;
  const val = raw.trim();
  if (val.startsWith("[")) return [];
  if (val.startsWith("{")) return {};
  if (val === "true" || val === "false") return val === "true";
  if (/^[0-9]+(\.[0-9]+)?$/.test(val)) return Number(val);
  const strMatch = val.match(/^['"]([^'"]*)['"]$/);
  if (strMatch) return strMatch[1];
  return undefined;
};

const parseFieldsArray = (arrayText) => {
  const entries = splitTopLevel(arrayText);
  return entries
    .map((entry) => {
      const strMatch = entry.match(/^['"]([^'"]+)['"]$/);
      if (strMatch) return { name: strMatch[1] };
      if (!entry.startsWith("{")) return null;
      const nameMatch = entry.match(/name\s*:\s*['"]([^'"]+)['"]/);
      const segmentNameMatch = entry.match(
        /segment_name\s*:\s*['"]([^'"]+)['"]/
      );
      const columnNameMatch = entry.match(
        /column_name\s*:\s*['"]([^'"]+)['"]/
      );
      const typeMatch = entry.match(/type\s*:\s*['"]([^'"]+)['"]/);
      const nodeIdMatch = entry.match(/nodeID\s*:\s*['"]([^'"]+)['"]/);
      const canBeFormula = /canBeFormula\s*:\s*true/.test(entry);
      const defaultMatch = entry.match(/default\s*:\s*([^,}]+)/);
      return {
        name: nameMatch ? nameMatch[1] : undefined,
        segment_name: segmentNameMatch ? segmentNameMatch[1] : undefined,
        column_name: columnNameMatch ? columnNameMatch[1] : undefined,
        type: typeMatch ? typeMatch[1] : undefined,
        nodeID: nodeIdMatch ? nodeIdMatch[1] : undefined,
        canBeFormula,
        default: parseDefaultValue(defaultMatch ? defaultMatch[1] : ""),
      };
    })
    .filter(Boolean);
};

const extractCraftMetadataFromContent = (content) => {
  const results = [];
  const craftRegex = /([A-Za-z0-9_]+)\.craft\s*=\s*\{/g;
  const arrayByIdentifier = {};
  if (content) {
    const arrayRegex = /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*\[/g;
    let arrayMatch;
    while ((arrayMatch = arrayRegex.exec(content))) {
      const name = arrayMatch[2];
      const arrayStart = content.indexOf("[", arrayMatch.index);
      const arrayEnd = findMatchingBracket(content, arrayStart, "[", "]");
      if (arrayEnd === -1) continue;
      const arrayText = content.slice(arrayStart + 1, arrayEnd);
      arrayByIdentifier[name] = parseFieldsArray(arrayText);
    }
  }
  let match;
  while ((match = craftRegex.exec(content))) {
    const compName = match[1];
    const start = match.index + match[0].length - 1;
    const end = findMatchingBracket(content, start, "{", "}");
    if (end === -1) continue;
    const block = content.slice(start, end + 1);
    const displayMatch = block.match(/displayName\s*:\s*['"]([^'"]+)['"]/);
    const segmentMatch = block.match(/segment_type\s*:\s*['"]([^'"]+)['"]/);
    const hasContents = /hasContents\s*:\s*true/.test(block);
    const fieldsMatch = block.match(/fields\s*:\s*\[/);
    let fields = [];
    if (fieldsMatch) {
      const arrayStart = block.indexOf("[", fieldsMatch.index);
      const arrayEnd = findMatchingBracket(block, arrayStart, "[", "]");
      if (arrayEnd > arrayStart) {
        const arrayText = block.slice(arrayStart + 1, arrayEnd);
        fields = parseFieldsArray(arrayText);
      }
    } else {
      const fieldsRefMatch = block.match(/fields\s*:\s*([A-Za-z0-9_]+)/);
      if (fieldsRefMatch) {
        const refName = fieldsRefMatch[1];
        if (arrayByIdentifier[refName]) fields = arrayByIdentifier[refName];
      } else if (/\bfields\s*[,}]/.test(block)) {
        if (arrayByIdentifier.fields) fields = arrayByIdentifier.fields;
      }
    }
    const parsePropsBlock = (matchInfo) => {
      let props = {};
      if (!matchInfo) return props;
      const objStart = block.indexOf("{", matchInfo.index);
      const objEnd = findMatchingBracket(block, objStart, "{", "}");
      if (objEnd > objStart) {
        const objText = block.slice(objStart + 1, objEnd);
        splitTopLevel(objText).forEach((entry) => {
          const kv = entry.match(/([A-Za-z0-9_]+)\s*:\s*([^,}]+)/);
          if (!kv) return;
          props[kv[1]] = parseDefaultValue(kv[2]);
        });
      }
      return props;
    };
    const propsMatch = block.match(/props\s*:\s*\{/);
    const defaultPropsMatch = block.match(/defaultProps\s*:\s*\{/);
    const props = parsePropsBlock(propsMatch);
    const defaultProps = parsePropsBlock(defaultPropsMatch);
    const segmentVarsMatch = block.match(/segment_vars\s*:\s*\{/);
    let segmentVars = {};
    if (segmentVarsMatch) {
      const objStart = block.indexOf("{", segmentVarsMatch.index);
      const objEnd = findMatchingBracket(block, objStart, "{", "}");
      if (objEnd > objStart) {
        const objText = block.slice(objStart + 1, objEnd);
        splitTopLevel(objText).forEach((entry) => {
          const kv = entry.match(/([A-Za-z0-9_]+)\s*:\s*([^,}]+)/);
          if (!kv) return;
          segmentVars[kv[1]] = parseDefaultValue(kv[2]);
        });
      }
    }
    results.push({
      component: compName,
      displayName: displayMatch ? displayMatch[1] : compName,
      segment_type: segmentMatch ? segmentMatch[1] : undefined,
      hasContents,
      fields,
      props,
      defaultProps,
      segmentVars,
    });
  }
  return results;
};

const parseLiteralValue = (valueText) => {
  const raw = (valueText || "").trim();
  if (!raw) return undefined;
  if (raw.startsWith("[")) {
    const inner = raw.slice(1, -1);
    const parts = splitTopLevel(inner);
    return parts
      .map((part) => parseLiteralValue(part))
      .filter((val) => typeof val !== "undefined");
  }
  if (raw === "true" || raw === "false") return raw === "true";
  if (/^[0-9]+(\.[0-9]+)?$/.test(raw)) return Number(raw);
  const strMatch = raw.match(/^['"]([^'"]*)['"]$/);
  if (strMatch) return strMatch[1];
  return undefined;
};

const parseObjectLiteralProps = (objText) => {
  const props = {};
  splitTopLevel(objText).forEach((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("...")) return;
    const kv = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (!kv) return;
    const value = parseLiteralValue(kv[2]);
    props[kv[1]] = typeof value === "undefined" ? kv[2].trim() : value;
  });
  return props;
};

const parseSettingsFieldObject = (fieldText) => {
  const props = parseObjectLiteralProps(fieldText);
  if (!props.name || typeof props.name !== "string") return null;
  if (props.attributes && typeof props.attributes === "string") {
    const minMatch = props.attributes.match(/min\s*:\s*([0-9.]+)/);
    const maxMatch = props.attributes.match(/max\s*:\s*([0-9.]+)/);
    const stepMatch = props.attributes.match(/step\s*:\s*([0-9.]+)/);
    if (minMatch) props.min = Number(minMatch[1]);
    if (maxMatch) props.max = Number(maxMatch[1]);
    if (stepMatch) props.step = Number(stepMatch[1]);
  }
  return props;
};

const extractSettingsFieldsArrayFromContent = (content) => {
  if (!content || !content.includes("SettingsFromFields")) return [];
  const results = [];
  const fieldsRegex = /(const|let|var)\s+fields\s*=\s*\[/g;
  let match;
  while ((match = fieldsRegex.exec(content))) {
    const arrayStart = content.indexOf("[", match.index);
    const arrayEnd = findMatchingBracket(content, arrayStart, "[", "]");
    if (arrayEnd === -1) continue;
    const arrayText = content.slice(arrayStart + 1, arrayEnd);
    const fields = parseFieldsArray(arrayText);
    fields.forEach((field) => {
      if (!field.name) return;
      results.push(field);
    });
  }
  return results;
};

const extractSettingsConstraintsFromContent = (content) => {
  const entries = [];
  const callRegex = /SettingsRow\s*\(/g;
  let match;
  while ((match = callRegex.exec(content))) {
    const callStart = content.indexOf("(", match.index);
    const callEnd = findMatchingBracket(content, callStart, "(", ")");
    if (callEnd === -1) continue;
    const callText = content.slice(callStart + 1, callEnd);
    const fieldIdx = callText.indexOf("field");
    if (fieldIdx === -1) continue;
    const fieldBraceStart = callText.indexOf("{", fieldIdx);
    if (fieldBraceStart === -1) continue;
    const fieldBraceEnd = findMatchingBracket(
      callText,
      fieldBraceStart,
      "{",
      "}"
    );
    if (fieldBraceEnd === -1) continue;
    const fieldText = callText.slice(fieldBraceStart + 1, fieldBraceEnd);
    const field = parseSettingsFieldObject(fieldText);
    if (!field) continue;
    const isStyle = /isStyle\s*=\s*\{?\s*true/.test(callText);
    const subPropMatch = callText.match(/subProp\s*=\s*{?['"]([^'"]+)['"]}?/);
    const valuePostfixMatch = callText.match(
      /valuePostfix\s*=\s*{?['"]([^'"]+)['"]}?/
    );
    entries.push({
      ...field,
      isStyle,
      subProp: subPropMatch ? subPropMatch[1] : undefined,
      valuePostfix: valuePostfixMatch ? valuePostfixMatch[1] : undefined,
    });
  }
  const fieldsEntries = extractSettingsFieldsArrayFromContent(content);
  fieldsEntries.forEach((field) => {
    entries.push({ ...field, isStyle: false });
  });
  return entries;
};

const loadCraftMetadata = () => {
  if (craftMetadataCache) return craftMetadataCache;
  const elementsDir = resolveBuilderPath("src/components/elements");
  let files = [];
  try {
    files = fs.readdirSync(elementsDir);
  } catch (e) {
    craftMetadataCache = { byDisplayName: {}, bySegmentType: {} };
    return craftMetadataCache;
  }
  const byDisplayName = {};
  const bySegmentType = {};
  const settingsByDisplayName = {};
  files
    .filter((f) => f.endsWith(".js"))
    .forEach((file) => {
      const content = safeReadFile(path.join(elementsDir, file));
      if (!content) return;
      const entries = extractCraftMetadataFromContent(content);
      const settings = extractSettingsConstraintsFromContent(content);
      const propNames = extractPropNamesFromContent(content);
      entries.forEach((entry) => {
        entry.propNames = propNames;
        if (entry.displayName) byDisplayName[entry.displayName] = entry;
        if (entry.segment_type) bySegmentType[entry.segment_type] = entry;
        if (entry.displayName && settings.length) {
          settingsByDisplayName[entry.displayName] = settings;
        }
      });
    });
  craftMetadataCache = { byDisplayName, bySegmentType, settingsByDisplayName };
  return craftMetadataCache;
};

let craftToSaltcornCache = null;

const collectObjectLiteralEntries = (objText) => {
  const entries = [];
  const queue = splitTopLevel(objText);
  while (queue.length) {
    const entry = queue.shift();
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("...")) {
      const spreadObjStart = trimmed.indexOf("{");
      if (spreadObjStart !== -1) {
        const spreadObjEnd = findMatchingBracket(
          trimmed,
          spreadObjStart,
          "{",
          "}"
        );
        if (spreadObjEnd !== -1) {
          const spreadText = trimmed.slice(spreadObjStart + 1, spreadObjEnd);
          queue.push(...splitTopLevel(spreadText));
        }
      }
      continue;
    }
    entries.push(trimmed);
  }
  return entries;
};

const extractCraftToSaltcornMappings = (content) => {
  const mappings = [];
  if (!content) return mappings;
  const ifRegex =
    /if\s*\(\s*node\.displayName\s*===\s*([A-Za-z0-9_]+)\.craft\.displayName\s*\)\s*\{/g;
  let match;
  while ((match = ifRegex.exec(content))) {
    const compName = match[1];
    const blockStart = match.index + match[0].length - 1;
    const blockEnd = findMatchingBracket(content, blockStart, "{", "}");
    if (blockEnd === -1) continue;
    const block = content.slice(blockStart + 1, blockEnd);
    const objByVar = {};
    const varValueByName = {};
    const varPropByName = {};
    const extractAssignedExpression = (text, startIndex) => {
      let depthParen = 0;
      let depthBrace = 0;
      let depthBracket = 0;
      let inString = false;
      let stringChar = "";
      let escaped = false;
      for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === stringChar) {
            inString = false;
            stringChar = "";
          }
          continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
          inString = true;
          stringChar = ch;
          continue;
        }
        if (ch === "(") depthParen += 1;
        if (ch === ")") depthParen -= 1;
        if (ch === "{") depthBrace += 1;
        if (ch === "}") depthBrace -= 1;
        if (ch === "[") depthBracket += 1;
        if (ch === "]") depthBracket -= 1;
        if (ch === ";" && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
          return text.slice(startIndex, i).trim();
        }
      }
      return text.slice(startIndex).trim();
    };
    const assignRegex = /(const|let|var)\s+([A-Za-z0-9_]+)\s*(=\s*)?/g;
    let assignMatch;
    while ((assignMatch = assignRegex.exec(block))) {
      const varName = assignMatch[2];
      const exprStart = assignMatch.index + assignMatch[0].length;
      if (assignMatch[3]) {
        const expr = extractAssignedExpression(block, exprStart);
        if (expr) {
          varValueByName[varName] = expr;
          const propMatch = expr.match(/^node\.props\.([A-Za-z0-9_]+)/);
          if (propMatch) varPropByName[varName] = propMatch[1];
        }
      }
      if (block[exprStart] === "{") {
        const objStart = block.indexOf("{", exprStart);
        const objEnd = findMatchingBracket(block, objStart, "{", "}");
        if (objEnd !== -1) objByVar[varName] = block.slice(objStart + 1, objEnd);
      }
    }
    const assignmentRegex = /(^|[^=!<>])\b([A-Za-z0-9_]+)\s*=\s*/g;
    let assignmentMatch;
    while ((assignmentMatch = assignmentRegex.exec(block))) {
      const varName = assignmentMatch[2];
      const exprStart = assignmentMatch.index + assignmentMatch[0].length;
      const expr = extractAssignedExpression(block, exprStart);
      if (!expr) continue;
      varValueByName[varName] = expr;
      const propMatch = expr.match(/^node\.props\.([A-Za-z0-9_]+)/);
      if (propMatch) varPropByName[varName] = propMatch[1];
    }
    const returnObjects = [];
    const returnObjRegex = /return\s*\{/g;
    let returnObjMatch;
    while ((returnObjMatch = returnObjRegex.exec(block))) {
      const objStart = block.indexOf("{", returnObjMatch.index);
      const objEnd = findMatchingBracket(block, objStart, "{", "}");
      if (objEnd === -1) continue;
      returnObjects.push(block.slice(objStart + 1, objEnd));
    }
    const returnVarRegex = /return\s+([A-Za-z0-9_]+)/g;
    let returnVarMatch;
    while ((returnVarMatch = returnVarRegex.exec(block))) {
      const varName = returnVarMatch[1];
      if (objByVar[varName]) returnObjects.push(objByVar[varName]);
    }
    if (!returnObjects.length) continue;
    const props = {};
    let segmentType = null;
    returnObjects.forEach((objText) => {
      const entries = collectObjectLiteralEntries(objText);
      entries.forEach((entry) => {
        const kv = entry.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
        let key = null;
        let value = null;
        if (kv) {
          key = kv[1];
          value = kv[2].trim();
        } else {
          const ident = entry.match(/^([A-Za-z0-9_]+)$/);
          if (!ident) return;
          key = ident[1];
          value = varValueByName[key] || key;
        }
        if (key === "type") {
          const typeMatch = value.match(/^['"]([^'"]+)['"]/);
          if (typeMatch) segmentType = typeMatch[1];
        }
        if (!props[key]) props[key] = { value, sourceProps: [] };
        const sourceRegex = /node\.props\.([A-Za-z0-9_]+)/g;
        let sourceMatch;
        while ((sourceMatch = sourceRegex.exec(value))) {
          props[key].sourceProps.push(sourceMatch[1]);
        }
        if (!props[key].sourceProps.length && varPropByName[key]) {
          props[key].sourceProps.push(varPropByName[key]);
        }
      });
    });
    if (!segmentType && Object.keys(props).includes("besides")) segmentType = "columns";
    mappings.push({
      component: compName,
      segmentType,
      props,
    });
  }
  return mappings;
};

const loadCraftToSaltcornMappings = () => {
  if (craftToSaltcornCache) return craftToSaltcornCache;
  const storagePath = resolveBuilderPath("src/components/storage.js");
  const content = safeReadFile(storagePath);
  const mappings = extractCraftToSaltcornMappings(content);
  const byDisplayName = {};
  mappings.forEach((entry) => {
    byDisplayName[entry.component] = entry;
  });
  const result = { byDisplayName };
  craftToSaltcornCache = result;
  return craftToSaltcornCache;
};

const extractToolboxComponentsByMode = () => {
  if (toolboxComponentsCache) return toolboxComponentsCache;
  const toolboxPath = resolveBuilderPath("src/components/Toolbox.js");
  const content = safeReadFile(toolboxPath);
  if (!content) {
    toolboxComponentsCache = {};
    return toolboxComponentsCache;
  }
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+["']\.\/elements\/[^"']+["']/g;
  const importedComponents = new Set();
  let match;
  while ((match = importRegex.exec(content))) {
    match[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((name) => importedComponents.add(name));
  }

  const elemToComponent = {};
  const elemRegex = /const\s+([A-Za-z0-9_]+Elem)\s*=\s*\([^)]*\)\s*=>\s*\{/g;
  while ((match = elemRegex.exec(content))) {
    const elemName = match[1];
    const blockStart = match.index + match[0].length - 1;
    const blockEnd = findMatchingBracket(content, blockStart, "{", "}");
    if (blockEnd === -1) continue;
    const block = content.slice(blockStart, blockEnd + 1);
    const isRegex = /\bis\s*=\s*\{\s*([A-Z][A-Za-z0-9_]*)\s*\}/g;
    let isMatch;
    while ((isMatch = isRegex.exec(block))) {
      const tag = isMatch[1];
      if (importedComponents.has(tag)) {
        elemToComponent[elemName] = tag;
        break;
      }
    }
    if (!elemToComponent[elemName]) {
      const tagRegex = /<([A-Z][A-Za-z0-9_]*)\b/g;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(block))) {
        const tag = tagMatch[1];
        if (importedComponents.has(tag)) {
          elemToComponent[elemName] = tag;
          break;
        }
      }
    }
    if (!elemToComponent[elemName]) {
      const fallback = elemName.replace(/Elem$/, "");
      if (importedComponents.has(fallback)) elemToComponent[elemName] = fallback;
    }
  }

  const extractMode = (toolboxName) => {
    const nameIdx = content.indexOf(`const ${toolboxName}`);
    if (nameIdx === -1) return [];
    const arrowIdx = content.indexOf("=>", nameIdx);
    if (arrowIdx === -1) return [];
    const blockStart = content.indexOf("{", arrowIdx);
    const blockEnd = findMatchingBracket(content, blockStart, "{", "}");
    if (blockEnd === -1) return [];
    const block = content.slice(blockStart, blockEnd + 1);
    const chunkIdx = block.indexOf("chunkToolBox(");
    if (chunkIdx === -1) return [];
    const arrayStart = block.indexOf("[", chunkIdx);
    const arrayEnd = findMatchingBracket(block, arrayStart, "[", "]");
    if (arrayEnd === -1) return [];
    const arrayText = block.slice(arrayStart + 1, arrayEnd);
    const elemNames = [];
    const elemRefRegex = /<([A-Za-z0-9_]+Elem)\b/g;
    let elemMatch;
    while ((elemMatch = elemRefRegex.exec(arrayText))) {
      elemNames.push(elemMatch[1]);
    }
    return elemNames
      .map((name) => elemToComponent[name])
      .filter(Boolean);
  };

  toolboxComponentsCache = {
    show: extractMode("ToolboxShow"),
    list: extractMode("ToolboxList"),
    filter: extractMode("ToolboxFilter"),
    edit: extractMode("ToolboxEdit"),
    page: extractMode("ToolboxPage"),
  };
  return toolboxComponentsCache;
};

const buildBuilderSchema = async ({ mode, table }) => {
  const normalizedMode = (mode || "show").toLowerCase();
  const rawIcons = getState().icons || [];
  const icons = (Array.isArray(rawIcons) ? rawIcons : Object.keys(rawIcons)).slice(0, 15);
  const textStyleOptions = loadTextStyleOptions();
  const options = {
    mode: normalizedMode,
    fields: [],
    views: [],
    actions: [],
    icons,
  };
  let tableRecord = null;
  if (table) {
    const lookup =
      typeof table === "number" || /^[0-9]+$/.test(String(table))
        ? { id: Number(table) }
        : { name: table };
    tableRecord = await Table.findOne(lookup);
  }
  if (tableRecord) {
    const fields = tableRecord.getFields ? await tableRecord.getFields() : [];
    options.fields = fields.map((field) => {
      const fieldviews = Object.keys(field.type?.fieldviews || {});
      return {
        name: field.name,
        label: field.label || field.name,
        type: field.type?.name || field.type || field.input_type || "String",
        required: !!field.required,
        primary_key: !!field.primary_key,
        calculated: !!field.calculated,
        fieldviews: fieldviews.length ? fieldviews : ["show"],
      };
    });
    try {
      const views = await View.find_table_views_where(tableRecord.id, () => true);
      options.views = views.map((v) => v.name).filter(Boolean);
    } catch (e) {
      options.views = [];
    }
  } else {
    const views = await View.find();
    options.views = views.map((v) => v.name).filter(Boolean);
  }

  const stateActions = getState().actions || {};
  const builtIns =
    normalizedMode === "edit" || normalizedMode === "filter"
      ? edit_build_in_actions || []
      : ["Delete", "GoBack"];
  const triggers = Trigger.find({
    when_trigger: { or: ["API call", "Never"] },
  }).filter((tr) => tr.name);
  options.actions = Array.from(
    new Set([
      ...builtIns,
      ...Object.keys(stateActions),
      ...triggers.map((tr) => tr.name),
    ])
  ).filter(Boolean);

  const toolboxByMode = extractToolboxComponentsByMode();
  const allowedComponents = Array.from(
    new Set(toolboxByMode[normalizedMode] || [])
  );
  const craftMetadata = loadCraftMetadata();

  const craftToSaltcornMappings = loadCraftToSaltcornMappings();

  const labelForOptions = options.fields.map((f) => ({
    name: f.name,
    label: f.label,
  }));
  const fieldNameOptions = options.fields.map((f) => f.name);
  const fieldviewOptions = Array.from(
    new Set(
      options.fields.flatMap((f) => f.fieldviews || []).filter(Boolean)
    )
  );
  const anyValueRef = "#/$defs/any_value";
  const enumRefs = {
    fieldName: "#/$defs/field_name_enum",
    fieldview: "#/$defs/fieldview_enum",
    action: "#/$defs/action_name_enum",
    view: "#/$defs/view_name_enum",
    icon: "#/$defs/icon_enum",
    textStyle: "#/$defs/text_style_enum",
  };

  const schemaFromConstraint = (constraint) => {
    const typeMap = {
      Integer: "integer",
      Bool: "boolean",
      Color: "string",
      DimUnits: "string",
      String: "string",
      Font: "string",
    };
    const schema = {};
    if (constraint.type && typeMap[constraint.type]) {
      schema.type = typeMap[constraint.type];
    } else {
      schema.type = "string";
    }
    if (constraint.options && constraint.options.length) {
      schema.enum = constraint.options;
    }
    if (typeof constraint.min === "number") schema.minimum = constraint.min;
    if (typeof constraint.max === "number") schema.maximum = constraint.max;
    if (typeof constraint.step === "number") schema.multipleOf = constraint.step;
    if (constraint.valuePostfix) {
      schema.pattern = `${escapeRegex(constraint.valuePostfix)}$`;
    }
    return schema;
  };

  const makePropertySchema = ({ fieldSpec, propName, defaultValue, segmentType }) => {
    const name = propName || fieldSpec?.name;
    if (!name) return null;
    if (fieldSpec?.type === "Nodes" || fieldSpec?.nodeID) {
      return { $ref: "#/$defs/segment" };
    }
    const fieldTypeMap = {
      Integer: "integer",
      Float: "number",
      Bool: "boolean",
      String: "string",
      Color: "string",
      DimUnits: "string",
      Font: "string",
    };
    if (fieldSpec?.type && fieldTypeMap[fieldSpec.type]) {
      return { type: fieldTypeMap[fieldSpec.type] };
    }
    if (name === "labelFor" && fieldNameOptions.length) {
      return { $ref: enumRefs.fieldName };
    }
    if (
      (name === "field_name" || name === "field" || name === "join_field") &&
      fieldNameOptions.length
    ) {
      return { $ref: enumRefs.fieldName };
    }
    if (
      (name === "view" || (segmentType === "view" && name === "name")) &&
      options.views.length
    ) {
      return { $ref: enumRefs.view };
    }
    if (
      (name === "action_name" || (segmentType === "action" && name === "name")) &&
      options.actions.length
    ) {
      return { $ref: enumRefs.action };
    }
    if (
      (name === "icon" || name === "action_icon" || name === "link_icon") &&
      options.icons.length
    ) {
      return { $ref: enumRefs.icon };
    }
    if (name === "fieldview" && fieldviewOptions.length) {
      return { $ref: enumRefs.fieldview };
    }
    if (name === "textStyle" && textStyleOptions.length) {
      return {
        anyOf: [
          { $ref: enumRefs.textStyle },
          { type: "array", items: { $ref: enumRefs.textStyle } },
        ],
      };
    }
    if (defaultValue !== undefined) {
      if (Array.isArray(defaultValue)) return { type: "array" };
      if (defaultValue && typeof defaultValue === "object")
        return { type: "object" };
      return { type: typeof defaultValue };
    }
    return { $ref: anyValueRef };
  };


  const defs = {
    segment: { anyOf: [] },
    stack: {
      type: "object",
      required: ["above"],
      properties: {
        above: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/segment" },
        },
      },
    },
    columns: {
      type: "object",
      required: ["besides"],
      properties: {
        besides: {
          type: "array",
          minItems: 2,
          items: { anyOf: [{ $ref: "#/$defs/segment" }, { type: "null" }] },
        },
        widths: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 12 },
        },
      },
    },
  };

  defs.any_value = {
    type: ["string", "number", "boolean", "object", "array", "null"],
  };

  if (fieldNameOptions.length) {
    defs.field_name_enum = {
      type: "string",
      enum: fieldNameOptions,
    };
  }
  if (fieldviewOptions.length) {
    defs.fieldview_enum = {
      type: "string",
      enum: fieldviewOptions,
    };
  }
  if (options.actions.length) {
    defs.action_name_enum = {
      type: "string",
      enum: options.actions,
    };
  }
  if (options.views.length) {
    defs.view_name_enum = {
      type: "string",
      enum: options.views,
    };
  }
  if (options.icons.length) {
    defs.icon_enum = {
      type: "string",
      enum: options.icons,
    };
  }
  if (textStyleOptions.length) {
    defs.text_style_enum = {
      type: "string",
      enum: textStyleOptions,
    };
  }

  defs.segment.anyOf.push({ $ref: "#/$defs/stack" });
  defs.segment.anyOf.push({ $ref: "#/$defs/columns" });

  const componentDefinitions = [];
  const segmentDefs = {};
  const ensureSegmentDef = (segmentType) => {
    if (!segmentType) return null;
    if (segmentType === "columns" || segmentType === "stack") return null;
    if (!segmentDefs[segmentType]) {
      segmentDefs[segmentType] = {
        type: "object",
        required: ["type"],
        properties: {
          type: { const: segmentType },
        },
      };
      defs.segment.anyOf.push({ $ref: `#/$defs/${segmentType}` });
    }
    return segmentDefs[segmentType];
  };

  const isAnyValueSchema = (schema) =>
    schema && schema.$ref === anyValueRef;
  const isSegmentSchema = (schema) =>
    schema && schema.$ref === "#/$defs/segment";
  const isArrayOfSegmentsSchema = (schema) =>
    schema &&
    schema.type === "array" &&
    schema.items &&
    (isSegmentSchema(schema.items) || isArrayOfSegmentsSchema(schema.items));
  const addPropSchema = (properties, name, schema) => {
    if (!name || !schema) return;
    const existing = properties[name];
    if (!existing || (isAnyValueSchema(existing) && !isAnyValueSchema(schema))) {
      properties[name] = schema;
    }
  };

  const inferSchemaFromValueExpr = (valueExpr) => {
    const expr = String(valueExpr || "");
    const hasNodes = /\bget_nodes\s*\(|\bgo\s*\(|nodes\s*\[/.test(expr);
    const hasMap = /\.map\s*\(/.test(expr);
    const ntimesCount = (expr.match(/\bntimes\s*\(/g) || []).length;
    if (hasNodes && ntimesCount >= 2) {
      return {
        type: "array",
        items: { type: "array", items: { $ref: "#/$defs/segment" } },
      };
    }
    if (hasNodes && ntimesCount === 1) {
      return { type: "array", items: { $ref: "#/$defs/segment" } };
    }
    if (hasNodes && hasMap) {
      return { type: "array", items: { $ref: "#/$defs/segment" } };
    }
    if (hasNodes) return { $ref: "#/$defs/segment" };
    if (ntimesCount >= 2) return { type: "array", items: { type: "array" } };
    if (ntimesCount === 1) return { type: "array" };
    return null;
  };

  allowedComponents.forEach((compName) => {
    const meta = craftMetadata.byDisplayName[compName] || {};
    const mapping = craftToSaltcornMappings.byDisplayName[compName];
    const segmentType = meta.segment_type || mapping?.segmentType;
    const excludedPropNames = new Set();
    if (mapping && mapping.props) {
      Object.keys(mapping.props).forEach((targetKey) => {
        const sourceProps = mapping.props[targetKey].sourceProps || [];
        sourceProps.forEach((sourceProp) => {
          if (sourceProp && sourceProp !== targetKey) {
            excludedPropNames.add(sourceProp);
          }
        });
      });
    }
    const schemaRef =
      segmentType === "columns"
        ? "#/$defs/columns"
        : segmentType === "stack"
          ? "#/$defs/stack"
          : segmentType
            ? `#/$defs/${segmentType}`
            : null;
    componentDefinitions.push({
      component: compName,
      segment_type: segmentType || null,
      schema_ref: schemaRef,
    });

    const segmentDef = ensureSegmentDef(segmentType);
    if (!segmentDef) return;
    const properties = segmentDef.properties;
    const required = new Set(["type"]);
    const settings = craftMetadata.settingsByDisplayName
      ? craftMetadata.settingsByDisplayName[compName]
      : [];
    const styleConstraints = (settings || []).filter((s) => s.isStyle);
    const propConstraints = (settings || []).filter((s) => !s.isStyle);
    (meta.fields || []).forEach((f) => {
      const key = f.segment_name || f.name;
      if (!key) return;
      if (excludedPropNames.has(key)) return;
      const schema = makePropertySchema({
        fieldSpec: f,
        propName: key,
        defaultValue: f.default,
        segmentType,
      });
      addPropSchema(properties, key, schema);
      if ((f.type === "Nodes" || f.nodeID) && key === "contents") {
        required.add(key);
      }
    });
    const defaultProps = { ...(meta.props || {}), ...(meta.defaultProps || {}) };
    Object.keys(defaultProps).forEach((key) => {
      if (excludedPropNames.has(key)) return;
      const schema = makePropertySchema({
        propName: key,
        defaultValue: defaultProps[key],
        segmentType,
      });
      addPropSchema(properties, key, schema);
    });
    const segmentVars = meta.segmentVars || {};
    Object.keys(segmentVars).forEach((key) => {
      if (excludedPropNames.has(key)) return;
      const schema = makePropertySchema({
        propName: key,
        defaultValue: segmentVars[key],
        segmentType,
      });
      addPropSchema(properties, key, schema);
    });
    (meta.propNames || []).forEach((key) => {
      if (excludedPropNames.has(key)) return;
      const schema = makePropertySchema({ propName: key, segmentType });
      addPropSchema(properties, key, schema);
    });
    propConstraints.forEach((c) => {
      if (!c.name) return;
      if (excludedPropNames.has(c.name)) return;
      if (c.subProp) {
        if (!properties[c.subProp]) {
          properties[c.subProp] = {
            type: "object",
            properties: {},
            additionalProperties: true,
          };
        }
        if (!properties[c.subProp].properties) {
          properties[c.subProp].properties = {};
        }
        properties[c.subProp].properties[c.name] = schemaFromConstraint(c);
        return;
      }
      addPropSchema(properties, c.name, schemaFromConstraint(c));
    });
    if (styleConstraints.length) {
      const styleSchema = { type: "object", properties: {}, additionalProperties: true };
      styleConstraints.forEach((c) => {
        if (!c.name) return;
        styleSchema.properties[c.name] = schemaFromConstraint(c);
      });
      addPropSchema(properties, "style", styleSchema);
    }
    if (meta.hasContents && !properties.contents) {
      properties.contents = { $ref: "#/$defs/segment" };
      required.add("contents");
    }
    if (mapping && mapping.props) {
      Object.keys(mapping.props).forEach((key) => {
        if (key === "type") return;
        if (properties[key] && !isAnyValueSchema(properties[key])) return;
        const sourceProps = mapping.props[key].sourceProps || [];
        const sourceProp = sourceProps.length ? sourceProps[0] : null;
        const defaultValue =
          sourceProp && meta.defaultProps ? meta.defaultProps[sourceProp] : undefined;
        let schema = null;
        const valueExpr = mapping.props[key].value || "";
        schema = inferSchemaFromValueExpr(valueExpr);
        if (!schema) {
          schema = makePropertySchema({
            propName: key,
            defaultValue,
            segmentType,
          });
        }
        addPropSchema(properties, key, schema);
        if (key === "contents" && (isSegmentSchema(schema) || isArrayOfSegmentsSchema(schema))) {
          required.add("contents");
        }
      });
    }
    if (segmentType === "table") {
      ["rows", "columns", "contents"].forEach((key) => {
        if (properties[key]) required.add(key);
      });
    }
    segmentDef.required = Array.from(required);
  });

  Object.assign(defs, segmentDefs);

  return {
    schema: {
      type: "object",
      required: ["layout"],
      properties: {
        layout: { $ref: "#/$defs/segment" },
      },
      $defs: defs,
    },
    meta: {
      mode: normalizedMode,
      table: tableRecord
        ? { id: tableRecord.id, name: tableRecord.name }
        : null,
      allowedComponents,
      componentDefinitions,
      fields: labelForOptions,
      actions: options.actions,
      views: options.views,
    },
  };
};

/**
 * @type {object}
 * @const
 * @namespace scapiRouter
 * @category server
 * @subcategory routes
 */
const router = new Router();
module.exports = router;

/**
 * Check that user has right to read sc service api data.
 * Only admin currently can call this api.
 * @param {object} req httprequest
 * @param {object} user user based on access token
 * @returns {boolean}
 */
function accessAllowedRead(req, user) {
  const role =
    req.user && req.user.id
      ? req.user.role_id
      : user && user.role_id
        ? user.role_id
        : 100;

  if (role === 1) return true;
  return false;
}

// todo add paging
// todo more granular access rights for api. Currently only admin can call this api.
// todo add support of fields
/**
 * List SC Tables using GET
 * @name get/sc_tables
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_tables/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const tables = await Table.find({});

          res.json({ success: tables });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights for api. Currently only admin can call this api.
/**
 * List SC Views using GET
 * @name get/sc_views
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_views/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const views = await View.find({}, { cached: true });

          res.json({ success: views });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

/**
 * Builder schema endpoint
 * @name get/builder_schema
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/builder_schema/",
  error_catcher(async (req, res, next) => {
    const mode = req.query.mode || "show";
    const table = req.query.table || null;
    const useCache = !req.query.nocache;
    const tenant = db.getTenantSchema();
    const cacheKey = `${tenant}|${mode}|${table || ""}`;
    const cached = builderSchemaCache.get(cacheKey);
    if (useCache && cached && Date.now() - cached.ts < BUILDER_SCHEMA_TTL_MS) {
      res.json({ success: cached.value, cached: true });
      return;
    }
    const value = await buildBuilderSchema({ mode, table });
    builderSchemaCache.set(cacheKey, { ts: Date.now(), value });
    res.json({ success: value, cached: false });
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Pages using GET
 * @name get/sc_pages
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_pages/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const pages = await Page.find({});

          res.json({ success: pages });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Files using GET
 * @name get/sc_files
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_files/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const files = await File.find({});

          res.json({ success: files });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Triggers using GET
 * @name get/sc_triggers
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_triggers/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const triggers = Trigger.find({});

          res.json({ success: triggers });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Roles using GET
 * @name get/sc_roles
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_roles/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const roles = await Role.find({});

          res.json({ success: roles });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Tenants using GET
 * @name get/sc_tenants
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_tenants/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const tenants = await Tenant.getAllTenants();

          res.json({ success: tenants });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Plugins using GET
 * @name get/sc_plugins
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_plugins/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const plugins = await Plugin.find({});

          res.json({ success: plugins });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

// todo add paging
// todo more granular access rights to api. Currently only admin can call this api.
/**
 * List SC Config Items using GET
 * @name get/sc_config
 * @function
 * @memberof module:routes/scapi~scapiRouter
 * @function
 */
router.get(
  "/sc_config/",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const configVars = await Config.getAllConfig();

          res.json({ success: configVars });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

router.get(
  "/reload",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          await getState().refresh_plugins();
          res.json({ success: true });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

router.post(
  "/reload",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        if (accessAllowedRead(req, user)) {
          const { tenant, new_tenant } = req.body;
          if (new_tenant) {
            add_tenant(new_tenant);

            await db.runWithTenant(new_tenant, loadAllPlugins);

            process_send({ createTenant: new_tenant });
          }
          if (tenant) {
            await db.runWithTenant(tenant, async () => {
              await getState().refresh_plugins();
            });
          } else await getState().refresh_plugins();
          res.json({ success: true });
        } else {
          res.status(401).json({ error: req.__("Not authorized") });
        }
      }
    )(req, res, next);
  })
);

router.post(
  "/run-view-route/:viewname/:route",
  error_catcher(async (req, res, next) => {
    await passport.authenticate(
      "api-bearer",
      { session: false },
      async function (err, user, info) {
        const { viewname, route } = req.params;
        const role = user?.id ? user.role_id : 100;
        const state = getState();
        state.log(
          3,
          `Route /view/${viewname} viewroute ${route} user=${req.user?.id}${
            state.getConfig("log_ip_address", false) ? ` IP=${req.ip}` : ""
          }`
        );

        const view = View.findOne({ name: viewname });
        if (!view) {
          res
            .status(404)
            .json({ error: req.__(`No such view: %s`, text(viewname)) });
          state.log(2, `View ${viewname} not found`);
        } else if (role > view.min_role) {
          res.status(401).json({ error: req.__("Not authorized") });
          state.log(2, `View ${viewname} viewroute ${route} not authorized`);
        } else {
          req.user = user;
          await view.runRoute(route, req.body || {}, res, { res, req });
        }
      }
    )(req, res, next);
  })
);
