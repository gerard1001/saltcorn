const {
  div,
  button,
  form,
  select,
  option,
  label,
  text,
} = require("@saltcorn/markup/tags");

const Tag = require("@saltcorn/data/models/tag");
const TagEntry = require("@saltcorn/data/models/tag_entry");
const Router = require("express-promise-router");

const {
  isAdmin,
  error_catcher,
  csrfField,
  isAdminOrHasConfigMinRole,
  checkEditPermission,
  is_relative_url,
} = require("./utils");

const Table = require("@saltcorn/data/models/table");
const View = require("@saltcorn/data/models/view");
const Page = require("@saltcorn/data/models/page");
const Trigger = require("@saltcorn/data/models/trigger");

const router = new Router();
module.exports = router;

const buildFields = (entryType, formOptions, req) => {
  return Object.entries(formOptions).map(([type, list]) => {
    return div(
      { class: "form-group row" },
      div({ class: "col-sm-2" }, label("type")),
      div(
        { class: "col-sm-10" },
        select(
          {
            name: "ids",
            class: "form-control form-select",
            multiple: true,
            size: 20,
          },
          list.map((entry) => {
            return option({ value: entry.id, label: entry.name });
          })
        )
      ),
      div(
        { class: "col-sm-12" },
        button({ type: "submit", class: "btn btn-primary" }, req.__("Save"))
      )
    );
  });
};

const buildForm = (entryType, tag_id, formOptions, req) => {
  return form(
    { action: `/tag-entries/add/${entryType}/${tag_id}`, method: "post" },
    csrfField(req),
    buildFields(entryType, formOptions, req)
  );
};

const formOptions = async (type, tag_id) => {
  const tag = await Tag.findOne({ id: tag_id });
  switch (type) {
    case "tables": {
      const ids = await tag.getTableIds();
      return {
        tables: (await Table.find()).filter(
          (value) => ids.indexOf(value.id) === -1
        ),
      };
    }
    case "views": {
      const ids = await tag.getViewIds();
      return {
        views: (await View.find()).filter(
          (value) => ids.indexOf(value.id) === -1
        ),
      };
    }
    case "pages": {
      const ids = await tag.getPageIds();
      return {
        pages: (await Page.find()).filter(
          (value) => ids.indexOf(value.id) === -1
        ),
      };
    }
    case "triggers": {
      const ids = await tag.getTriggerIds();
      return {
        triggers: (
          await Trigger.findDB({}, { orderBy: "name", nocase: true })
        ).filter((value) => ids.indexOf(value.id) === -1),
      };
    }
  }
};

router.get(
  "/add/:entry_type/:tag_id",
  isAdmin,
  error_catcher(async (req, res) => {
    const { entry_type, tag_id } = req.params;
    const tag = await Tag.findOne({ id: tag_id });

    res.sendWrap(req.__("Add %s to tag %s", entry_type, tag.name), {
      above: [
        {
          type: "breadcrumbs",
          crumbs: [
            { text: req.__(`Tags`), href: "/tag" },
            { text: tag.name, href: `/tag/${tag.id}` },
            { text: req.__(`Add %s`, text(entry_type)) },
          ],
        },
        {
          type: "card",
          title: req.__(`Add entries to tag %s`, tag.name),
          contents: buildForm(
            entry_type,
            tag_id,
            await formOptions(entry_type, tag_id),
            req
          ),
        },
      ],
    });
  })
);

const idField = (entryType) => {
  switch (entryType) {
    case "tables":
    case "table": {
      return "table_id";
    }
    case "views":
    case "view": {
      return "view_id";
    }
    case "pages":
    case "page": {
      return "page_id";
    }
    case "triggers":
    case "trigger": {
      return "trigger_id";
    }
  }
  return null;
};

// add multiple objects to one tag
router.post(
  "/add/:entry_type/:tag_id",
  isAdmin,
  error_catcher(async (req, res) => {
    const { entry_type, tag_id } = req.params;
    const { ids } = req.body || {};
    if (!ids) {
      req.flash("error", req.__("Please select at least one item"));
      return res.redirect(`/tag-entries/add/${entry_type}/${tag_id}`);
    }
    const ids_array = Array.isArray(ids) ? ids : [ids];
    const fieldName = idField(entry_type);
    const tag = await Tag.findOne({ id: tag_id });
    for (const id of ids_array) {
      await tag.addEntry({ [fieldName]: id });
    }
    res.redirect(`/tag/${tag_id}?show_list=${entry_type}`);
  })
);

router.post(
  "/add-tag-entity/:tagname/:entitytype/:entityid",
  isAdminOrHasConfigMinRole([
    "min_role_edit_tables",
    "min_role_edit_views",
    "min_role_edit_pages",
    "min_role_edit_triggers",
  ]),
  error_catcher(async (req, res) => {
    const { tagname, entitytype, entityid } = req.params;
    const tag = await Tag.findOne({ name: tagname });

    const fieldName = idField(entitytype);
    const auth = checkEditPermission(entitytype, req.user);
    if (!auth) req.flash("error", "Not authorized");
    else await tag.addEntry({ [fieldName]: +entityid });
    let redirectTarget =
      req.query.on_done_redirect &&
      is_relative_url("/" + req.query.on_done_redirect)
        ? `/${req.query.on_done_redirect}`
        : null;
    switch (entitytype) {
      case "views":
        res.redirect(redirectTarget || `/viewedit`);
        break;
      case "pages":
        res.redirect(redirectTarget || `/pageedit`);
        break;
      case "tables":
        res.redirect(redirectTarget || `/table`);
        break;
      case "triggers":
        res.redirect(redirectTarget || `/actions`);
        break;

      default:
        break;
    }
  })
);

// add one object to multiple tags
router.post(
  "/add/multiple_tags/:entry_type/:object_id",
  isAdmin,
  error_catcher(async (req, res) => {
    let { entry_type, object_id } = req.params;
    let { tag_ids } = req.body || {};
    object_id = parseInt(object_id);
    tag_ids = tag_ids.map((id) => parseInt(id));
    const tags = (await Tag.find()).filter((tag) => tag_ids.includes(tag.id));
    const fieldName = idField(entry_type);
    for (const tag of tags) {
      await tag.addEntry({ [fieldName]: object_id });
    }
    res.json({ tags });
  })
);

router.post(
  "/remove/:entry_type/:entry_id/:tag_id",
  isAdmin,
  error_catcher(async (req, res) => {
    const { tag_id, entry_type, entry_id } = req.params;
    const fieldName = idField(entry_type);
    const entry = await TagEntry.findOne({ tag_id, [fieldName]: entry_id });
    entry[fieldName] = undefined;
    if (entry.isEmpty()) {
      await entry.delete();
    } else {
      await TagEntry.update(entry.id, { [fieldName]: null });
    }
    if (!req.xhr) res.redirect(`/tag/${tag_id}?show_list=${entry_type}`);
    else res.json({ okay: true });
  })
);
