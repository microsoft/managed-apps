# Apps on Microsoft Copilot Managed Runtime

> [!IMPORTANT]
> **We've moved to [Copilot Managed Runtime](https://github.com/microsoft/Copilot-Managed-Runtime).**
> Use the new repository for current development and [new issues](https://github.com/microsoft/Copilot-Managed-Runtime/issues/new/choose).
> Existing open issues will be transferred with their discussion history; **you do not need to resubmit them**.

> [!NOTE]
> Copilot Managed Runtime is in **public preview**. APIs, templates, and tooling may change before general availability.

Copilot Managed Runtime hosts Microsoft 365 line-of-business applications that automatically inherit organizational governance, security, and compliance controls from the moment they're created.

This repository retains the legacy first-party project **templates** and closed issue history. Current templates, tooling, and **public issues** are maintained in [Copilot Managed Runtime](https://github.com/microsoft/Copilot-Managed-Runtime). The legacy tooling ships as npm packages under the `@microsoft/managed-apps` scope:

| Package | Description |
| --- | --- |
| [`@microsoft/managed-apps`](https://www.npmjs.com/package/@microsoft/managed-apps) | SDK for building apps hosted on Copilot Managed Runtime |
| [`@microsoft/managed-apps-cli`](https://www.npmjs.com/package/@microsoft/managed-apps-cli) | Command-line interface for building and managing apps hosted on Copilot Managed Runtime |
| [`@microsoft/managed-apps-vite-plugin`](https://www.npmjs.com/package/@microsoft/managed-apps-vite-plugin) | Vite plugin for apps hosted on Copilot Managed Runtime |

## Getting started

See the [Quickstart - CLI](https://go.microsoft.com/fwlink/?LinkId=2368962) to set up your local dev environment and build your first app.

## Repository structure

- [`templates/`](templates/) — first-party project templates (currently [`vite8`](templates/vite8), a React + TypeScript + Vite 8 starter).
- [`plugins/`](plugins/) — the [`microsoft-managed-apps`](plugins/microsoft-managed-apps) plugin: skills, agents, and hooks for building apps hosted on Copilot Managed Runtime with AI coding agents (works with Claude Code and GitHub Copilot).
- [`.claude-plugin/`](.claude-plugin/) — marketplace manifest (`marketplace.json`) that registers the plugin so agents can install it via `/plugin marketplace add`.

## Documentation

See the [Microsoft Copilot Managed Runtime documentation](https://go.microsoft.com/fwlink/?LinkId=2372842).

## Support

Please [search issues in Copilot Managed Runtime](https://github.com/microsoft/Copilot-Managed-Runtime/issues) before filing a new bug to avoid duplicates, and check the historical issues here if relevant. File new bugs in [the CMR issue tracker](https://github.com/microsoft/Copilot-Managed-Runtime/issues/new/choose), not this repository. Existing open reports will be transferred by maintainers and kept open for continued triage; please do not resubmit them. See [SUPPORT.md](SUPPORT.md) for details.

## Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
