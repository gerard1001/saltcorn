/**
 * @category saltcorn-builder
 * @module components/elements/HTMLCode
 * @subcategory components / elements
 */

import React, { Fragment, useContext } from "react";
import { useNode } from "@craftjs/core";
import {
  blockProps,
  BlockSetting,
  SettingsFromFields,
  TextStyleSetting,
} from "./utils";
import optionsCtx from "../context";

export /**
 * @param {object} props
 * @param {string} props.text
 * @returns {span}
 * @namespace
 * @category saltcorn-builder
 * @subcategory components
 */
const HTMLCode = ({ text }) => {
  const {
    selected,
    connectors: { connect, drag },
  } = useNode((node) => ({ selected: node.events.selected }));
  return (
    <span
      className={`is-html-block ${selected ? "selected-node" : ""}`}
      ref={(dom) => connect(drag(dom))}
    >
      <div style={{ fontSize: "8px" }}>HTML</div>
      <div dangerouslySetInnerHTML={{ __html: text }}></div>
    </span>
  );
};

const fields = (mode) => {
  return [
    {
      label: "HTML Code",
      name: "text",
      type: "textarea",
      segment_name: "contents",
      onSave: (segment, node_props) => {
        const div = document.createElement("div");
        div.innerHTML = (node_props.text || "").trim();
        const children = []; // Type: Node[]
        const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const s = walker.currentNode.data?.trim?.();
          if (s && !(s.startsWith("{{") && s.endsWith("}}"))) children.push(s);
        }
        segment.text_strings = [...new Set(children.sort())];
      },
      sublabel:
        mode === "show" || mode === "list"
          ? "Access fields with <code>{{ var_name }}</code>"
          : undefined,
    },
  ];
};

/**
 * @type {object}
 */
HTMLCode.craft = {
  displayName: "HTMLCode",
  related: {
    settings: () => {
      const options = useContext(optionsCtx);

      return SettingsFromFields(fields(options.mode))();
    },
    segment_type: "blank",
    segment_vars: { isHTML: true },
    segment_match: (segment) => segment.isHTML,
    fields: fields(),
  },
};
