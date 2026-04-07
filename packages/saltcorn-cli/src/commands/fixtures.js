/**
 * @category saltcorn-cli
 * @module commands/fixtures
 */
const { Command, Flags } = require("@oclif/core");
const { maybe_as_tenant, parseJSONorString } = require("../common");
/**
 * FixturesCommand Class
 * @extends oclif.Command
 * @category saltcorn-cli
 */
class FixturesCommand extends Command {
  /**
   * @returns {Promise<void>}
   */
  async run() {
    const fixtures = require("@saltcorn/data/db/fixtures");
    const reset = require("@saltcorn/data/db/reset_schema");
    const { flags } = await this.parse(FixturesCommand);
    if (flags.tenant) {
      const Plugin = require("@saltcorn/data/models/plugin");
      const { init_multi_tenant } = require("@saltcorn/data/db/state");
      const { getAllTenants } = require("@saltcorn/admin-models/models/tenant");
      await Plugin.loadAllPlugins();
      const tenants = await getAllTenants();
      await init_multi_tenant(Plugin.loadAllPlugins, undefined, tenants);
    }
    await maybe_as_tenant(flags.tenant, async () => {
      if (flags.reset) {
        await reset();
      }
      await fixtures();
    });

    this.exit(0);
  }
}

/**
 * @type {string}
 */
FixturesCommand.description = `Load fixtures for testing
...
This manual step it is never required for users and rarely required for developers
`;

/**
 * @type {object}
 */
FixturesCommand.flags = {
  reset: Flags.boolean({ char: "r", description: "Also reset schema" }),
  tenant: Flags.string({
    char: "t",
    description: "tenant",
  }),
};

module.exports = FixturesCommand;
