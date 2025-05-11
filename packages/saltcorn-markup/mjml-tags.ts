/**
 * @category saltcorn-markup
 * @module mjml-tags
 */

import mkTag = require("./mktag");
const tags: string[] = [
  "head",
  "style",
  "body",
  "section",
  "column",
  "image",
  "text",
  "divider",
  "raw",
  "button",
  "group",
  "attributes",
];
const allTags: { [k: string]: (...args: any[]) => string } = Object.fromEntries(
  tags.map((tag) => [tag, mkTag(`mj-${tag}`)])
);
const mjml = mkTag("mjml");
type ExportsType = {
  [key: string]: any; // "...allTags" properties
};

//https://www.litmus.com/blog/a-guide-to-bulletproof-buttons-in-email-design
const emailButton = (
  {
    href,
    title,
    btnStyle,
    style,
  }: { href: string; title?: string; btnStyle?: string; style?: string },
  label: string
) => {
  const rawType = (btnStyle || "").replace("btn ", "");
  let bgColor = (btnStyle || "").includes("outline")
    ? "transparent"
    : `#6c757d`;
  let color = `#ffffff`;
  let borderColor = null;
  switch (rawType) {
    case "btn-primary":
      bgColor = `#0d6efd`;
      break;
    case "btn-secondary":
      bgColor = `#6c757d`;
      break;
    case "btn-success":
      bgColor = `#198754`;
      break;
    case "btn-danger":
      bgColor = `#dc3545`;
      break;
    case "btn-warning":
      bgColor = `#ffc107`;
      break;
    case "btn-info":
      bgColor = `#0dcaf0`;
      break;
    case "btn-outline-primary":
      color = borderColor = `#0d6efd`;
      break;
    case "btn-outline-secondary":
      color = borderColor = `#6c757d`;
      break;
    case "btn-outline-success":
      color = borderColor = `#198754`;
      break;
    case "btn-outline-danger":
      color = borderColor = `#dc3545`;
      break;
    case "btn-outline-warning":
      color = borderColor = `#ffc107`;
      break;
    case "btn-outline-info":
      color = borderColor = `#0dcaf0`;
      break;
  }
//  console.log({ href, btnStyle, rawType, label, style, borderColor, color });
  return `<a rel="noopener" target="_blank" ${title ? `title="${title}" ` : ""}href="${href}" style="${style && style.includes("color") ? `${style}; border-width: 1px; border-style: solid;` : `background-color: ${bgColor}; color: ${color};`} ${borderColor ? `border-color: ${borderColor};border-width:1px; border-style: solid; ` : ""}font-size: 18px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; text-decoration: none; padding: 14px 20px; border-radius: 5px; display: inline-block; mso-padding-alt: 0;">
    <!--[if mso]>
    <i style="letter-spacing: 25px; mso-font-width: -100%; mso-text-raise: 30pt;">&nbsp;</i>
    <![endif]-->
    <span style="mso-text-raise: 15pt;">${label}</span>
    <!--[if mso]>
    <i style="letter-spacing: 25px; mso-font-width: -100%;">&nbsp;</i>
    <![endif]-->
</a>`;
};
const tagsExports: ExportsType = {
  ...allTags,
  mjml,
  emailButton,
};

export = tagsExports;
